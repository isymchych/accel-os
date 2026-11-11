import assert from "node:assert/strict";
import path from "node:path";
import test, { mock } from "node:test";
import { setImmediate } from "node:timers/promises";

import type { SessionSnapshot, SessionSummary, StoredSession } from "../../src/desktop-api.ts";
import type { PiLaunch } from "../../src/electron/rpc.ts";

// Control only owner startup/disposal. The real workspace handles reservations,
// catalog validation, target selection, and shutdown across every owner.
const owners: ControlledOwner[] = [];
let catalog: StoredSession[] = [];
let startOwner: (owner: ControlledOwner) => Promise<void> = async () => {};
let closeOwner: (owner: ControlledOwner) => Promise<void> = async () => {};

class ControlledOwner {
  public readonly state: SessionSummary;
  public closeCalls = 0;
  private readonly sessionPath: string | null;
  public constructor(launch: PiLaunch) {
    const index = launch.args.indexOf("--session");
    this.sessionPath = index < 0 ? null : (launch.args[index + 1] ?? null);
    this.state = {
      key: `owner-${owners.length}`,
      revision: 0,
      cwd: launch.cwd,
      name: "Conversation",
      connection: "starting",
      execution: "unknown",
      sessionId: null,
      sessionFile: null,
    };
    owners.push(this);
  }
  public summary(): SessionSummary {
    return { ...this.state };
  }
  public snapshot(): SessionSnapshot {
    return {
      ...this.summary(),
      messages: [],
      streaming: "",
      tools: [],
      activity: null,
      notice: null,
      error: null,
    };
  }
  public subscribe(): () => void {
    return () => {};
  }
  public async start(): Promise<void> {
    await startOwner(this);
    this.state.connection = "connected";
    this.state.execution = "idle";
    this.state.sessionFile = this.sessionPath;
    this.state.sessionId = this.state.sessionFile ? "stored" : this.state.key;
  }
  public async list(): Promise<StoredSession[]> {
    return catalog;
  }
  public async close(): Promise<void> {
    this.closeCalls += 1;
    await closeOwner(this);
    this.state.connection = "disconnected";
    this.state.execution = "unknown";
  }
}

mock.module("node:fs/promises", { exports: { realpath: async (value: string) => value } });
mock.module(path.resolve(import.meta.dirname, "../../src/electron/session.ts"), {
  exports: { DesktopSession: ControlledOwner },
});
const { DesktopWorkspace } = await import("../../src/electron/workspace.ts");

async function fixture(t: test.TestContext): Promise<InstanceType<typeof DesktopWorkspace>> {
  owners.length = 0;
  startOwner = async (): Promise<void> => {};
  closeOwner = async (): Promise<void> => {};
  catalog = [
    {
      path: "/project/stored.jsonl",
      id: "stored",
      cwd: "/project",
      name: "Saved conversation",
      modified: "2026-01-01T00:00:00.000Z",
    },
  ];
  const workspace = new DesktopWorkspace({
    executable: "/unused/node",
    args: [],
    cwd: "/project",
    env: {},
  });
  t.after(async () => {
    closeOwner = async (): Promise<void> => {};
    await workspace.close();
  });
  await workspace.start();
  return workspace;
}

test("concurrent cold opens reserve one owner before startup completes", async (t) => {
  const workspace = await fixture(t);
  const startup = Promise.withResolvers<undefined>();
  startOwner = async (): Promise<void> => startup.promise;
  const first = workspace.open("/project", "/project/stored.jsonl");
  const second = workspace.open("/project", "/project/stored.jsonl");
  await setImmediate();
  assert.equal(owners.length, 2, "Only the initial owner and one cold-open child exist");
  assert.equal(owners[1]?.state.connection, "starting");
  startup.resolve(undefined);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.key, b.key);
  assert.equal(a.sessionId, "stored");
  assert.equal(workspace.snapshot().sessions.length, 2);
});

test("a failed cold open releases its reservation so an explicit retry can succeed", async (t) => {
  const workspace = await fixture(t);
  const startup = Promise.withResolvers<undefined>();
  startOwner = async (): Promise<void> => startup.promise;
  const first = assert.rejects(
    workspace.open("/project", "/project/stored.jsonl"),
    /startup failed/u,
  );
  const second = assert.rejects(
    workspace.open("/project", "/project/stored.jsonl"),
    /startup failed/u,
  );
  await setImmediate();
  assert.equal(owners.length, 2);
  startup.reject(new Error("startup failed"));
  await Promise.all([first, second]);
  startOwner = async (): Promise<void> => {};
  const retried = await workspace.open("/project", "/project/stored.jsonl");
  assert.equal(retried.connection, "connected");
  assert.equal(retried.sessionId, "stored");
  assert.equal(owners.length, 3);
  assert.equal(
    (await workspace.open("/project", "/project/stored.jsonl")).key,
    retried.key,
    "The successful retry becomes the sole reusable writer",
  );
});

test("reopening waits for a disconnected writer and shares the replacement", async (t) => {
  const workspace = await fixture(t);
  const original = await workspace.open("/project", "/project/stored.jsonl");
  const owner = owners[1];
  assert.ok(owner);
  owner.state.connection = "disconnected";
  const disposed = Promise.withResolvers<undefined>();
  closeOwner = async (item): Promise<void> => {
    if (item === owner) await disposed.promise;
  };
  const first = workspace.open("/project", "/project/stored.jsonl");
  const second = workspace.open("/project", "/project/stored.jsonl");
  await setImmediate();
  assert.equal(owners.length, 2, "No new writer starts before disposal");
  disposed.resolve(undefined);
  const [a, b] = await Promise.all([first, second]);
  assert.notEqual(a.key, original.key);
  assert.equal(a.key, b.key);
  assert.equal(a.connection, "connected");
  assert.equal(owners[0]?.state.connection, "connected");
});

test("reopening works when every previous child disconnected", async (t) => {
  const workspace = await fixture(t);
  const original = await workspace.open("/project", "/project/stored.jsonl");
  for (const owner of owners) owner.state.connection = "disconnected";
  const reopened = await workspace.open("/project", "/project/stored.jsonl");
  assert.notEqual(reopened.key, original.key);
  assert.equal(reopened.connection, "connected");
});

test("quit during cold-open startup disposes every attached owner and rejects the open", async (t) => {
  const workspace = await fixture(t);
  const startup = Promise.withResolvers<undefined>();
  startOwner = async (): Promise<void> => startup.promise;
  const opened = assert.rejects(
    workspace.open("/project", "/project/stored.jsonl"),
    /closed during startup/u,
  );
  await setImmediate();
  assert.equal(owners.length, 2);
  closeOwner = async (owner): Promise<void> => {
    if (owner === owners[1]) startup.reject(new Error("closed during startup"));
  };
  await workspace.close();
  await opened;
  assert.deepEqual(
    owners.map((owner) => owner.closeCalls),
    [1, 1],
  );
  await assert.rejects(workspace.create("/project"), /shutting down/u);
  assert.throws(() => workspace.session(workspace.initialKey), /unavailable/u);
  assert.equal(owners.length, 2, "Shutdown cannot create another child");
});

test("one disposal failure does not skip shutdown of the other owners", async (t) => {
  const workspace = await fixture(t);
  await workspace.create("/project");
  await workspace.create("/other");
  const attempted: string[] = [];
  closeOwner = async (owner): Promise<void> => {
    attempted.push(owner.state.key);
    if (owner === owners[1]) throw new Error("disposal failed");
  };
  await assert.rejects(workspace.close(), /Could not close every Pi session/u);
  assert.deepEqual(attempted.sort(), owners.map((owner) => owner.state.key).sort());
  assert.equal(owners[0]?.state.connection, "disconnected");
  assert.equal(owners[2]?.state.connection, "disconnected");
});
