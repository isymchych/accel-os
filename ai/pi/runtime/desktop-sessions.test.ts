import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { listDesktopSessions, snapshotDesktopSession } from "./desktop-sessions.ts";

test("discovery reports native message activity without changing on reopen", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-native-activity-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const storage = path.join(directory, "sessions");
  const session = SessionManager.create(directory, storage);
  session.appendMessage({ role: "user", content: "first", timestamp: 1_000 });
  const file = session.getSessionFile();
  assert.ok(file);
  assert.equal((await listDesktopSessions(storage))[0]?.modified, new Date(1_000).toISOString());
  const reopened = SessionManager.open(file);
  assert.equal((await listDesktopSessions(storage))[0]?.modified, new Date(1_000).toISOString());
  reopened.appendMessage({ role: "user", content: "continued", timestamp: 2_000 });
  assert.equal((await listDesktopSessions(storage))[0]?.modified, new Date(2_000).toISOString());
});

test("snapshots persist setup-only selections and allow independent continuation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-setup-snapshot-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const storage = path.join(directory, "sessions");
  const source = SessionManager.create(directory, storage);
  const model = source.appendModelChange("test-provider", "test-model");
  const thinking = source.appendThinkingLevelChange("high");
  const originalMessage = source.appendMessage({
    role: "user",
    content: "original conversation",
    timestamp: 1,
  });
  const sourceFile = source.getSessionFile();
  assert.ok(sourceFile);
  const before = await readFile(sourceFile, "utf8");
  const setupEntries = source.getEntries().slice(0, 2);

  for (const [index, selected] of [model, thinking].entries()) {
    await t.test(index === 0 ? "model selection" : "thinking selection", async () => {
      const forkFile = await snapshotDesktopSession(sourceFile, selected, storage);
      const fork = SessionManager.open(forkFile);
      assert.notEqual(fork.getSessionId(), source.getSessionId());
      assert.equal(fork.getHeader()?.parentSession, sourceFile);
      assert.equal(fork.getCwd(), directory);
      assert.deepEqual(fork.getEntries(), setupEntries.slice(0, index + 1));
      assert.equal(fork.getLeafId(), selected);
      const continuation = fork.appendMessage({
        role: "user",
        content: "independent first message",
        timestamp: 2,
      });
      const reopened = SessionManager.open(forkFile);
      assert.deepEqual(
        reopened.getEntries().map((entry) => entry.id),
        [...[model, thinking].slice(0, index + 1), continuation],
      );
      assert.equal(reopened.getEntry(continuation)?.parentId, selected);
      assert.equal(await readFile(sourceFile, "utf8"), before);
      assert.equal(source.getLeafId(), originalMessage);
    });
  }
});

test("discovery filters cwd and snapshots preserve lineage without migrating live sources", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-native-sessions-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const cwd = path.join(directory, "project");
  const other = path.join(directory, "other");
  const storage = path.join(directory, "sessions");
  await Promise.all([mkdir(cwd), mkdir(other)]);
  const source = SessionManager.create(cwd, storage);
  const first = source.appendMessage({ role: "user", content: "selected history", timestamp: 1 });
  source.appendMessage({ role: "user", content: "later history", timestamp: 2 });
  const otherSession = SessionManager.create(other, storage);
  otherSession.appendMessage({ role: "user", content: "other directory", timestamp: 3 });
  const sourceFile = source.getSessionFile();
  assert.ok(sourceFile);
  const before = await readFile(sourceFile, "utf8");
  assert.deepEqual(
    (await listDesktopSessions(storage, cwd)).map((entry) => entry.id),
    [source.getSessionId()],
  );
  assert.deepEqual(
    new Set((await listDesktopSessions(storage)).map((entry) => entry.id)),
    new Set([source.getSessionId(), otherSession.getSessionId()]),
  );
  const forkFile = await snapshotDesktopSession(sourceFile, first, storage);
  assert.equal(await readFile(sourceFile, "utf8"), before);
  const fork = SessionManager.open(forkFile);
  assert.notEqual(fork.getSessionId(), source.getSessionId());
  assert.equal(fork.getHeader()?.parentSession, sourceFile);
  assert.deepEqual(
    fork
      .getEntries()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.id),
    [first],
  );
  assert.equal(source.getLeafId(), source.getEntries().at(-1)?.id);

  const legacy = path.join(storage, "legacy.jsonl");
  const legacyBytes = before.replace('"version":3', '"version":2');
  assert.notEqual(legacyBytes, before);
  await writeFile(legacy, legacyBytes);
  const legacyFork = await snapshotDesktopSession(legacy, first, storage);
  assert.equal(await readFile(legacy, "utf8"), legacyBytes, "Only the private copy may migrate");
  assert.equal(SessionManager.open(legacyFork).getHeader()?.parentSession, legacy);
  await assert.rejects(snapshotDesktopSession(sourceFile, "missing-entry", storage), /not found/u);
  assert.equal(await readFile(sourceFile, "utf8"), before);
});

test("snapshot selects only the ancestor path, excluding siblings and later descendants", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "desktop-branched-snapshot-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const storage = path.join(directory, "sessions");
  const source = SessionManager.create(directory, storage);
  const root = source.appendMessage({ role: "user", content: "shared root", timestamp: 1 });
  source.appendMessage({ role: "user", content: "sibling branch", timestamp: 2 });
  source.branch(root);
  const selected = source.appendMessage({ role: "user", content: "selected branch", timestamp: 3 });
  const later = source.appendMessage({ role: "user", content: "later descendant", timestamp: 4 });
  const sourceFile = source.getSessionFile();
  assert.ok(sourceFile);
  const before = await readFile(sourceFile, "utf8");
  const forkFile = await snapshotDesktopSession(sourceFile, selected, storage);
  const fork = SessionManager.open(forkFile);
  assert.deepEqual(
    fork
      .getEntries()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.id),
    [root, selected],
  );
  assert.equal(fork.getLeafId(), selected);
  assert.equal(source.getLeafId(), later);
  fork.appendMessage({ role: "user", content: "independent continuation", timestamp: 5 });
  assert.equal(await readFile(sourceFile, "utf8"), before);
  assert.equal(fork.getHeader()?.parentSession, sourceFile);
  assert.notEqual(fork.getSessionId(), source.getSessionId());
});
