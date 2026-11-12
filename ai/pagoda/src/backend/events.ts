import { Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import type { SessionMetadata, SessionSnapshot } from "../contracts/index.ts";
import type { DesktopWorkspace } from "./workspace.ts";

/** Each connection observes current state without owning the underlying executions. */
export function observeWorkspace(
  workspace: DesktopWorkspace,
  shutdown: AbortSignal,
): HttpServerResponse.HttpServerResponse {
  const encoder = new TextEncoder();
  const pending = new Map<string, SessionSnapshot>();
  let metadata: SessionMetadata[] | undefined;
  let account: string | undefined;
  let stopped = false;
  let cleanup = (): void => {};
  let flush = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      const send = (event: string, value: unknown): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      flush = (): void => {
        if (stopped) return;
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
      const unsubscribe = workspace.subscribe((snapshot) => {
        pending.set(snapshot.key, snapshot);
        flush();
      });
      const unsubscribeMetadata = workspace.subscribeMetadata((next) => {
        metadata = next;
        flush();
      });
      const unsubscribeAccount = workspace.subscribeAccount((next) => {
        account = next;
        flush();
      });
      const heartbeat = setInterval(() => {
        if (!stopped && (controller.desiredSize ?? 0) > 0) send("heartbeat", {});
      }, 15_000);
      cleanup = (): void => {
        clearInterval(heartbeat);
        shutdown.removeEventListener("abort", stop);
        unsubscribe();
        unsubscribeMetadata();
        unsubscribeAccount();
      };
      shutdown.addEventListener("abort", stop, { once: true });
      if (shutdown.aborted) {
        stop();
        return;
      }
      send("ready", workspace.snapshot());
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
    Stream.fromReadableStream({ evaluate: () => stream, onError: (error) => error }),
    { contentType: "text/event-stream", headers: { "cache-control": "no-cache" } },
  );
}
