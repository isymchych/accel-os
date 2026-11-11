import type { SSEStreamingApi } from "hono/streaming";

import type { SessionSnapshot } from "../desktop-api.ts";
import type { DesktopWorkspace } from "./workspace.ts";

/**
 * Observers receive current snapshots on every connection; event replay is not
 * execution replay. Coalesce pending updates and evict slow observers, not work.
 */
export async function observeWorkspace(
  workspace: DesktopWorkspace,
  stream: SSEStreamingApi,
  shutdown: AbortSignal,
): Promise<void> {
  const pending = new Map<string, SessionSnapshot>();
  let wake: (() => void) | undefined;
  const isStopped = (): boolean => stream.aborted;
  const stop = (): void => {
    wake?.();
    stream.abort();
  };
  const enqueue = (snapshot: SessionSnapshot): void => {
    if (isStopped()) return;
    // Keep only the latest object per session, not serialized copies of every
    // delta. Individual histories retain their existing size contract.
    pending.set(snapshot.key, snapshot);
    if (pending.size > 256) stop();
    else wake?.();
  };
  stream.onAbort(stop);
  shutdown.addEventListener("abort", stop, { once: true });
  const unsubscribe = workspace.subscribe(enqueue);
  const heartbeat = setInterval(() => wake?.(), 15_000);
  const wait = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = undefined;
  };
  const flush = async (): Promise<void> => {
    if (isStopped()) return;
    const batch = [...pending.values()];
    pending.clear();
    const deadline = setTimeout(stop, 10_000);
    try {
      if (batch.length === 0) await stream.writeSSE({ event: "heartbeat", data: "{}" });
      for (const snapshot of batch) {
        if (isStopped()) break;
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });
      }
    } finally {
      clearTimeout(deadline);
    }
  };
  try {
    if (shutdown.aborted) return;
    const initial = workspace.snapshot();
    // Subscription and snapshot capture are synchronous; subsequent updates
    // queue while the initial workspace is being written.
    const readyDeadline = setTimeout(stop, 10_000);
    try {
      await stream.writeSSE({ event: "ready", data: JSON.stringify(initial) });
    } finally {
      clearTimeout(readyDeadline);
    }
    while (!isStopped()) {
      if (pending.size === 0) await wait();
      await flush();
    }
  } finally {
    clearInterval(heartbeat);
    shutdown.removeEventListener("abort", stop);
    unsubscribe();
  }
}
