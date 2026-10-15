import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import extension from "./index.ts";
import type { SuspendInhibitor } from "./suspend-inhibitor.ts";

type ActivityCounts = { acquisitions: number; releases: number };

type ActivityFixture = {
  emit: (name: string, event?: unknown) => Promise<void>;
  stateDir: string;
  stateFile: string;
  warnings: string[];
  counts: () => ActivityCounts;
  setIdle: (value: boolean) => void;
  state: () => Promise<string>;
};

async function fixture(t: TestContext, failInhibition = false): Promise<ActivityFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-agent-activity-"));
  const previousRuntimeDir = process.env["XDG_RUNTIME_DIR"];
  process.env["XDG_RUNTIME_DIR"] = root;
  let idle = true;
  let acquisitions = 0;
  let releases = 0;
  let inhibited = false;
  const warnings: string[] = [];
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: "/test/project",
    hasUI: true,
    isIdle: () => idle,
    ui: {
      notify(message: string): void {
        warnings.push(message);
      },
    },
  } as unknown as ExtensionContext;
  const inhibitor: SuspendInhibitor = {
    async acquire(reportError): Promise<void> {
      acquisitions += 1;
      if (failInhibition) {
        reportError("Access denied");
      } else {
        inhibited = true;
      }
    },
    release(): void {
      if (inhibited) {
        releases += 1;
        inhibited = false;
      }
    },
  };
  extension(pi, { inhibitor });
  const emit = async (name: string, event: unknown = {}): Promise<void> => {
    await handlers.get(name)?.(event, ctx);
  };
  const stateDir = path.join(root, "accel-os", "pi-agents");
  const stateFile = path.join(stateDir, `${process.pid}.state`);
  t.after(async () => {
    try {
      await emit("session_shutdown");
    } finally {
      if (previousRuntimeDir === undefined) {
        delete process.env["XDG_RUNTIME_DIR"];
      } else {
        process.env["XDG_RUNTIME_DIR"] = previousRuntimeDir;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
  return {
    emit,
    stateDir,
    stateFile,
    warnings,
    counts: (): ActivityCounts => ({ acquisitions, releases }),
    setIdle(value: boolean): void {
      idle = value;
    },
    async state(): Promise<string> {
      return readFile(stateFile, "utf8");
    },
  };
}

test("activity preserves the Waybar format and inhibits until the run truly settles", async (t) => {
  const activity = await fixture(t);
  await activity.emit("session_start");
  assert.match(await activity.state(), /^idle\n\d+\n\/test\/project\n$/u);
  activity.setIdle(false);
  await activity.emit("before_agent_start");
  await activity.emit("agent_start");
  await activity.emit("agent_end");
  assert.match(await activity.state(), /^working\n\d+\n\/test\/project\n$/u);
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 0 });

  // A compaction completion can still be inside an active run or retry.
  await activity.emit("session_compact", { willRetry: false });
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 0 });
  activity.setIdle(true);
  await activity.emit("agent_settled");
  assert.match(await activity.state(), /^idle\n/u);
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 1 });
});

test("failed manual compaction releases inhibition when Pi is idle", async (t) => {
  const activity = await fixture(t);
  activity.setIdle(false);
  await activity.emit("session_before_compact");
  activity.setIdle(true);
  await activity.emit("session_compact_failed", { aborted: true, willRetry: false });
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 1 });
  assert.match(await activity.state(), /^idle\n/u);
});

test("branch-summary failure without a terminal event is reconciled by the idle check", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const activity = await fixture(t);
  activity.setIdle(false);
  await activity.emit("session_before_tree", {
    preparation: { userWantsSummary: true, entriesToSummarize: [{}] },
  });
  t.mock.timers.tick(1_000);
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 0 });

  // Pi clears its busy state on summary failure/cancellation without session_tree.
  activity.setIdle(true);
  t.mock.timers.tick(1_000);
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 1 });
  await t.waitFor(async () => {
    assert.match(await activity.state(), /^idle\n/u);
  });
});

test("inhibitor failure does not suppress working-state reporting", async (t) => {
  const activity = await fixture(t, true);
  activity.setIdle(false);
  await activity.emit("agent_start");
  assert.match(await activity.state(), /^working\n/u);
  assert.match(activity.warnings.join("\n"), /suspend inhibition failed: Access denied/u);
});

test("Waybar failure does not prevent inhibitor acquisition or release", async (t) => {
  const activity = await fixture(t);
  await mkdir(path.dirname(activity.stateDir), { recursive: true });
  await writeFile(activity.stateDir, "blocked");
  try {
    activity.setIdle(false);
    await activity.emit("agent_start");
    assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 0 });
    assert.match(activity.warnings.join("\n"), /could not publish Waybar state/u);
    activity.setIdle(true);
    await activity.emit("agent_settled");
    assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 1 });
  } finally {
    await rm(activity.stateDir);
  }
});

test("shutdown drains pending writes, releases inhibition, and removes status", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const activity = await fixture(t);
  activity.setIdle(false);
  const start = activity.emit("agent_start");
  const shutdown = activity.emit("session_shutdown");
  await Promise.all([start, shutdown]);
  activity.setIdle(true);
  t.mock.timers.tick(5_000);
  await activity.emit("agent_start");
  await assert.rejects(readFile(activity.stateFile), { code: "ENOENT" });
  assert.deepEqual(activity.counts(), { acquisitions: 1, releases: 1 });
});
