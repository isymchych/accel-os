import { Effect, Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import type { SessionMetadata, SessionSnapshot, WorkspaceState } from "../contracts/index.ts";
import type { WorkspaceObservation, WorkspaceObservations } from "./observation.ts";

/** Each connection observes current state without owning the underlying executions. */
export function observeWorkspace(
  observations: WorkspaceObservations,
  shutdown: AbortSignal,
): HttpServerResponse.HttpServerResponse {
  const encoder = new TextEncoder();
  const pending = new Map<string, SessionSnapshot>();
  let metadata: SessionMetadata[] | undefined;
  let account: string | undefined;
  let ready = false;
  const beforeReady = new Map<string, { event: WorkspaceObservation; revision: number }>();
  let stopped = false;
  let cleanup = (): void => {};
  let flush = (): void => {};
  let deliverSnapshot = (_snapshot: { state: WorkspaceState; revision: number }): void => {};
  let failSnapshot = (_error: unknown): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      const send = (event: string, value: unknown): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      flush = (): void => {
        if (stopped || !ready) return;
        while ((controller.desiredSize ?? 0) > 0) {
          if (account !== undefined) {
            const next = account;
            account = undefined;
            send("account", next);
            continue;
          }
          if (metadata !== undefined) {
            const next = metadata;
            metadata = undefined;
            send("metadata", next);
            continue;
          }
          const next = pending.entries().next();
          if (next.done) break;
          pending.delete(next.value[0]);
          send("snapshot", next.value[1]);
        }
      };
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        cleanup();
        controller.close();
      };
      const receive = (event: WorkspaceObservation): void => {
        switch (event.type) {
          case "snapshot":
            pending.set(event.value.key, event.value);
            break;
          case "metadata":
            metadata = event.value;
            break;
          case "account":
            account = event.value;
            break;
          default:
            event satisfies never;
        }
        flush();
      };
      const unsubscribe = observations.subscribe((event, revision) => {
        if (ready) receive(event);
        else {
          const key = event.type === "snapshot" ? `snapshot:${event.value.key}` : event.type;
          beforeReady.set(key, { event, revision });
        }
      });
      const heartbeat = setInterval(() => {
        if (ready && !stopped && (controller.desiredSize ?? 0) > 0) send("heartbeat", {});
      }, 15_000);
      cleanup = (): void => {
        clearInterval(heartbeat);
        shutdown.removeEventListener("abort", stop);
        unsubscribe();
      };
      shutdown.addEventListener("abort", stop, { once: true });
      if (shutdown.aborted) {
        stop();
        return;
      }
      deliverSnapshot = ({ state, revision }): void => {
        if (stopped) return;
        send("ready", state);
        ready = true;
        for (const item of beforeReady.values()) {
          if (item.revision > revision) receive(item.event);
        }
        beforeReady.clear();
        flush();
      };
      failSnapshot = (error: unknown): void => {
        if (stopped) return;
        stopped = true;
        cleanup();
        controller.error(error);
      };
    },
    pull(): void {
      flush();
    },
    cancel(): void {
      if (stopped) return;
      stopped = true;
      cleanup();
    },
  });
  return HttpServerResponse.stream(
    Stream.unwrap(
      Effect.gen(function* () {
        yield* observations
          .snapshot()
          .pipe(
            Effect.match({ onSuccess: deliverSnapshot, onFailure: failSnapshot }),
            Effect.forkScoped,
          );
        return Stream.fromReadableStream({ evaluate: () => stream, onError: (error) => error });
      }),
    ),
    { contentType: "text/event-stream", headers: { "cache-control": "no-cache" } },
  );
}
