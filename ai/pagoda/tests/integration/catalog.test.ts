import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { SessionCatalog } from "../../src/backend/catalog.ts";
import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import { fakePiOptions } from "./fixtures/helpers.ts";

test("catalog discovers activity and snapshots legacy history without modifying its source", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-catalog-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const other = path.join(root, "other");
  const storage = path.join(root, "sessions");
  await Promise.all([mkdir(project), mkdir(other)]);
  const source = SessionManager.create(project, storage);
  const selected = source.appendMessage({ role: "user", content: "first", timestamp: 1_000 });
  source.appendMessage({ role: "user", content: "later", timestamp: 2_000 });
  const otherSession = SessionManager.create(other, storage);
  otherSession.appendMessage({ role: "user", content: "elsewhere", timestamp: 3_000 });
  const file = source.getSessionFile();
  assert.ok(file);
  const catalog = new SessionCatalog(storage);
  assert.deepEqual(
    (await catalog.list(project)).map((item) => item.id),
    [source.getSessionId()],
  );
  assert.equal((await catalog.list(project))[0]?.modified, new Date(2_000).toISOString());
  assert.deepEqual(
    new Set((await catalog.list()).map((item) => item.id)),
    new Set([source.getSessionId(), otherSession.getSessionId()]),
  );

  const original = await readFile(file, "utf8");
  const legacy = path.join(storage, "legacy.jsonl");
  const legacyContents = original.replace('"version":3', '"version":2');
  assert.notEqual(legacyContents, original);
  await writeFile(legacy, legacyContents);
  const forkFile = await catalog.snapshot(legacy, selected);
  assert.equal(await readFile(legacy, "utf8"), legacyContents);
  assert.equal(await readFile(file, "utf8"), original);
  const fork = SessionManager.open(forkFile);
  assert.equal(fork.getHeader()?.parentSession, legacy);
  assert.notEqual(fork.getSessionId(), source.getSessionId());
  assert.equal(fork.getLeafId(), selected);
  assert.equal(fork.getEntries().filter((entry) => entry.type === "message").length, 1);
  await assert.rejects(catalog.snapshot(legacy, "missing-entry"), /not found/u);
  assert.equal(await readFile(legacy, "utf8"), legacyContents);
});

test("workspace discovers native sessions without a connected execution owner", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-catalog-workspace-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const storage = path.join(root, "sessions");
  const session = SessionManager.create(root, storage);
  session.appendMessage({ role: "user", content: "saved", timestamp: 1_000 });
  const workspace = new DesktopWorkspace({ ...fakePiOptions(root), sessionDir: storage });
  t.after(async () => workspace.close());
  assert.deepEqual(
    (await workspace.list(root)).map((item) => item.id),
    [session.getSessionId()],
  );
  assert.deepEqual(
    (await workspace.listAll()).map((item) => item.id),
    [session.getSessionId()],
  );
});
