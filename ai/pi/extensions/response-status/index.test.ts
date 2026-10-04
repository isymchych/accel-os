import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import extension from "./index.ts";
import type { SummaryNotificationKind } from "./notify.ts";

interface Fixture {
  emit: (name: string, event: unknown, mode?: string) => Promise<void>;
  hasHandler: (name: string) => boolean;
  notifications: () => SummaryNotificationKind[];
}

function fixture(): Fixture {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const summaryNotifications: SummaryNotificationKind[] = [];
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown): void {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  extension(pi, {
    notifySummary(kind): void {
      summaryNotifications.push(kind);
    },
  });

  return {
    async emit(name, event, mode = "tui"): Promise<void> {
      const handler = handlers.get(name);
      assert.ok(handler, `missing ${name} handler`);
      await handler(event, { cwd: "/home/me/accel-os", mode });
    },
    hasHandler(name): boolean {
      return handlers.has(name);
    },
    notifications: (): SummaryNotificationKind[] => summaryNotifications,
  };
}

test("response status notifies after manual compaction and completed branch summaries", async () => {
  const status = fixture();

  await status.emit("session_compact", { reason: "manual" });
  await status.emit("session_tree", { summaryEntry: {} });

  assert.deepEqual(status.notifications(), ["compaction", "branch"]);
});

test("response status skips automatic compaction and ordinary branch navigation", async () => {
  const status = fixture();

  await status.emit("session_compact", { reason: "threshold" });
  await status.emit("session_compact", { reason: "overflow" });
  await status.emit("session_tree", { summaryEntry: undefined });

  assert.deepEqual(status.notifications(), []);
});

test("response status skips summarization notifications outside the TUI", async () => {
  const status = fixture();

  await status.emit("session_compact", { reason: "manual" }, "rpc");
  await status.emit("session_tree", { summaryEntry: {} }, "print");

  assert.deepEqual(status.notifications(), []);
});

test("response status has no handler for failed or cancelled compaction", () => {
  const status = fixture();

  assert.equal(status.hasHandler("session_compact_failed"), false);
});
