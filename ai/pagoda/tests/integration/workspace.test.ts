import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import { contentText, fakePiLaunch } from "./fixtures/helpers.ts";

async function fixture(
  t: test.TestContext,
): Promise<{ workspace: DesktopWorkspace; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-"));
  const workspace = new DesktopWorkspace(fakePiLaunch(directory));
  t.after(async () => {
    try {
      await workspace.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  return { workspace, directory };
}

test("reopening and navigation render native summary messages", async (t) => {
  const { workspace, directory } = await fixture(t);
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
  await workspace.start();
  const opened = await workspace.open(directory, file);
  const session = workspace.session(opened.key);
  await assert.rejects(session.prompt(" \n"), /Enter a message/u);
  assert.deepEqual(
    opened.messages.map((message) => contentText(message.content)),
    ["Compacted history", "Previous branch", "Latest"],
  );
  const branch = (await session.history()).entries.find((entry) => entry.id === "branch");
  assert.ok(branch);
  await session.navigate(branch.id);
  assert.deepEqual(
    session.snapshot().messages.map((message) => contentText(message.content)),
    ["Compacted history", "Previous branch"],
  );
});

test("independent owners survive view changes, reopen deduplicates, and forks preserve active work", async (t) => {
  const { workspace, directory } = await fixture(t);
  const other = path.join(directory, "other");
  await mkdir(other);
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
  const all = await workspace.listAll();
  assert.deepEqual(new Set(all.map((session) => session.cwd)), new Set([directory, other]));
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
    fork.messages.map((message) => contentText(message.content)),
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

test("model and thinking changes invalidate history; delivered queue entries invalidate controls", async (t) => {
  const { workspace } = await fixture(t);
  await workspace.start();
  const session = workspace.session(workspace.initialKey);
  let historyRevision = session.snapshot().historyRevision;
  await session.model("fake", "other");
  assert.ok(session.snapshot().historyRevision > historyRevision);
  historyRevision = session.snapshot().historyRevision;
  await session.thinking("low");
  assert.ok(session.snapshot().historyRevision > historyRevision);

  await session.prompt("hold");
  await session.prompt("queued message", "follow_up");
  assert.equal((await session.controls()).pendingMessageCount, 1);
  const before = session.snapshot().controlsRevision;
  let deliveredRevision = 0;
  const unsubscribe = session.subscribe((snapshot) => {
    if (snapshot.messages.some((message) => contentText(message.content) === "queued message")) {
      deliveredRevision ||= snapshot.controlsRevision;
    }
  });
  await session.prompt("__deliver_queued__", "steer");
  unsubscribe();
  assert.ok(deliveredRevision > before, "Delivery itself invalidates controls");
  assert.equal((await session.controls()).pendingMessageCount, 0);
  assert.equal(session.snapshot().execution, "running");
});
