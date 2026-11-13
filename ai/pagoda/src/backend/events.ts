import { Effect, Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import {
  SnapshotUpdateSchema,
  type SessionKey,
  type SessionSnapshot,
  type SessionUpdate,
} from "../contracts/index.ts";
import type { WorkspaceObservations } from "./observation.ts";

/** Compare immutable snapshots after coalescing, relative to this stream's baseline. */
function sessionUpdate(previous: SessionSnapshot, current: SessionSnapshot): SessionUpdate {
  const before = new Map(Object.entries(previous));
  const changes: unknown = Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) =>
        Object.hasOwn(SnapshotUpdateSchema.fields.changes.fields, key) && value !== before.get(key),
    ),
  );
  // The keys come from the update schema and values from the corresponding snapshot fields.
  return {
    key: current.key,
    revision: current.revision,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    changes: changes as SessionUpdate["changes"],
  };
}

/** SSE encodes application observations; its scope owns no SDK execution. */
export function observeWorkspace(
  observations: WorkspaceObservations,
): HttpServerResponse.HttpServerResponse {
  const stream = Stream.unwrap(
    Effect.gen(function* () {
      const { state, changes } = yield* observations.observe();
      const sent = new Map<SessionKey, SessionSnapshot>(
        state.sessions.map((session) => [session.key, session]),
      );
      const updates = changes.pipe(
        Stream.filter(
          (event) =>
            event.type !== "snapshot" ||
            event.value.revision > (sent.get(event.value.key)?.revision ?? -1),
        ),
        Stream.map((event) => {
          if (event.type !== "snapshot") return { type: event.type, value: event.value };
          const previous = sent.get(event.value.key);
          sent.set(event.value.key, event.value);
          return previous
            ? { type: "session-update", value: sessionUpdate(previous, event.value) }
            : { type: "snapshot", value: event.value };
        }),
        Stream.merge(
          Stream.tick("15 seconds").pipe(Stream.map(() => ({ type: "heartbeat", value: {} }))),
          { haltStrategy: "left" },
        ),
      );
      return Stream.concat(Stream.succeed({ type: "ready", value: state }), updates);
    }),
  ).pipe(
    Stream.interruptWhen(observations.awaitClose),
    Stream.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event.value)}\n\n`),
    Stream.encodeText,
  );
  return HttpServerResponse.stream(stream, {
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache" },
  });
}
