import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import extension from "./index.ts";

type ActivityFixture = {
  emit: (name: string, event?: unknown) => Promise<void>;
  stateDir: string;
  stateFile: string;
  warnings: string[];
  setIdle: (value: boolean) => void;
  state: () => Promise<string>;
};

async function fixture(t: TestContext): Promise<ActivityFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-agent-activity-"));
  const previousRuntimeDir = process.env["XDG_RUNTIME_DIR"];
  process.env["XDG_RUNTIME_DIR"] = root;
  let idle = true;
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
  extension(pi);
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
    setIdle(value: boolean): void {
      idle = value;
    },
    async state(): Promise<string> {
      return readFile(stateFile, "utf8");
    },
  };
}

test("activity preserves the state format and stays working until the run truly settles", async (t) => {
  const activity = await fixture(t);
  await activity.emit("session_start");
  assert.match(await activity.state(), /^idle\n\d+\n\/test\/project\n$/u);
  activity.setIdle(false);
  await activity.emit("before_agent_start");
  await activity.emit("agent_start");
  await activity.emit("agent_end");
  assert.match(await activity.state(), /^working\n\d+\n\/test\/project\n$/u);

  // A compaction completion can still be inside an active run or retry.
  await activity.emit("session_compact", { willRetry: false });
  assert.match(await activity.state(), /^working\n/u);
  activity.setIdle(true);
  await activity.emit("agent_settled");
  assert.match(await activity.state(), /^idle\n/u);
});

test("failed manual compaction reports idle when Pi is idle", async (t) => {
  const activity = await fixture(t);
  activity.setIdle(false);
  await activity.emit("session_before_compact");
  assert.match(await activity.state(), /^working\n/u);
  activity.setIdle(true);
  await activity.emit("session_compact_failed", { aborted: true, willRetry: false });
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
  assert.match(await activity.state(), /^working\n/u);

  // Pi clears its busy state on summary failure/cancellation without session_tree.
  activity.setIdle(true);
  t.mock.timers.tick(1_000);
  await t.waitFor(async () => {
    assert.match(await activity.state(), /^idle\n/u);
  });
});

test("publication failures are reported without breaking subsequent state writes", async (t) => {
  const activity = await fixture(t);
  await mkdir(path.dirname(activity.stateDir), { recursive: true });
  await writeFile(activity.stateDir, "blocked");
  try {
    activity.setIdle(false);
    await activity.emit("agent_start");
    assert.match(activity.warnings.join("\n"), /could not publish activity state/u);
  } finally {
    await rm(activity.stateDir);
  }
  activity.setIdle(true);
  await activity.emit("agent_settled");
  assert.match(await activity.state(), /^idle\n/u);
});

test("shutdown drains pending writes, stops reconciliation, and removes status", async (t) => {
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
});
