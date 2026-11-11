import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DesktopWorkspace } from "../../src/electron/workspace.ts";

test("reopening and navigation render native summary messages", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-summary-"));
  const native = path.join(directory, "native");
  await mkdir(native);
  const file = path.join(native, "summary.jsonl");
  await writeFile(
    file,
    JSON.stringify({
      id: "summary-session",
      cwd: directory,
      name: "Summaries",
      modified: "2026-01-01T00:00:00.000Z",
      leafId: "last",
      entries: [
        {
          id: "compact",
          parentId: null,
          type: "message",
          message: { role: "compactionSummary", summary: "Compacted history" },
        },
        {
          id: "branch",
          parentId: "compact",
          type: "message",
          message: { role: "branchSummary", summary: "Previous branch" },
        },
        {
          id: "last",
          parentId: "branch",
          type: "message",
          message: { role: "assistant", content: "Latest" },
        },
      ],
    }),
  );
  const workspace = new DesktopWorkspace({
    executable: process.execPath,
    args: [path.join(import.meta.dirname, "fixtures/fake-pi.ts")],
    cwd: directory,
    env: { HOME: directory, FAKE_PI_STATE: directory },
  });
  t.after(async () => {
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  await workspace.start();
  const opened = await workspace.open(directory, file);
  assert.deepEqual(
    opened.messages.map((message) => message.text),
    ["Compacted history", "Previous branch", "Latest"],
  );
  const session = workspace.session(opened.key);
  await session.navigate("branch");
  assert.deepEqual(
    session.snapshot().messages.map((message) => message.text),
    ["Compacted history", "Previous branch"],
  );
});

test("independent owners survive view changes, reopen deduplicates, and forks preserve active work", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-workspace-"));
  const other = path.join(directory, "other");
  await mkdir(other);
  const workspace = new DesktopWorkspace({
    executable: process.execPath,
    args: [path.join(import.meta.dirname, "fixtures/fake-pi.ts")],
    cwd: directory,
    env: { HOME: directory, FAKE_PI_STATE: directory },
  });
  t.after(async () => {
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  await workspace.start();
  const a = workspace.session(workspace.initialKey);
  await a.prompt("hold");
  const b = await workspace.create(other);
  assert.notEqual(a.summary().key, b.key);
  await workspace.session(b.key).prompt("B prompt");
  const historyA = await a.history();
  const entry = historyA.entries[0];
  assert.ok(entry);
  assert.equal(a.summary().execution, "running");
  const catalog = await workspace.list(directory);
  assert.equal(catalog.length, 1);
  const stored = catalog[0];
  assert.ok(stored);
  const [first, second] = await Promise.all([
    workspace.open(directory, stored.path),
    workspace.open(directory, stored.path),
  ]);
  assert.equal(first.key, workspace.initialKey);
  assert.equal(second.key, first.key);
  assert.equal(workspace.snapshot().sessions.length, 2);
  await assert.rejects(workspace.open(other, stored.path), /catalog/u);
  assert.equal(a.summary().execution, "running");

  const fork = await workspace.fork(a.summary().key, entry.id);
  assert.notEqual(fork.sessionId, a.summary().sessionId);
  assert.equal(a.summary().execution, "running");
  assert.deepEqual(
    fork.messages.map((message) => message.text),
    ["hold"],
  );
  await workspace.session(fork.key).prompt("fork prompt");
  assert.equal(a.summary().execution, "running");
  await a.prompt("later", "follow_up");
  await a.prompt("steering", "steer");
  await workspace.session(fork.key).stop();
  assert.equal(a.summary().execution, "running", "Stop on the destination cannot stop its source");
  await a.stop();
  assert.equal(a.summary().execution, "idle");
});
