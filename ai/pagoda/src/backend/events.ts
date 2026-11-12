import { Effect, Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import type { WorkspaceObservations } from "./observation.ts";

/** SSE encodes application observations; its scope owns no SDK execution. */
export function observeWorkspace(
  observations: WorkspaceObservations,
): HttpServerResponse.HttpServerResponse {
  const stream = Stream.unwrap(
    Effect.gen(function* () {
      const { state, changes } = yield* observations.observe();
      const updates = changes.pipe(
        Stream.map((event) => ({ type: event.type, value: event.value })),
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
