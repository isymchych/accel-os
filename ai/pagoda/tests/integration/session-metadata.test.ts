import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { startBackend } from "../../src/backend/server.ts";
import { SessionMetadataStore } from "../../src/backend/session-metadata.ts";
import { readInactivityHours } from "../../src/backend/settings.ts";
import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import type { SessionId } from "../../src/contracts/index.ts";
import { fakePiLaunch } from "./fixtures/helpers.ts";

test("session metadata persists independent flags", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-metadata-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  const store = new SessionMetadataStore(file);
  const id = "example-session" as SessionId;
  store.setFlag(id, "pinned", true);
  store.setFlag(id, "favourite", true);

  const reopened = new SessionMetadataStore(file);
  assert.deepEqual(reopened.list(), [{ id, pinned: true, favourite: true }]);
  reopened.setFlag(id, "pinned", false);
  assert.deepEqual(store.list(), [{ id, pinned: false, favourite: true }]);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), reopened.list());
  await writeFile(file, JSON.stringify([{ id, pinned: true, favourite: false, lastActivity: 10 }]));
  assert.deepEqual(reopened.list(), [{ id, pinned: true, favourite: false }]);
  reopened.setFlag(id, "favourite", true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), [
    { id, pinned: true, favourite: true },
  ]);
  await writeFile(file, "{broken");
  assert.throws(() => {
    reopened.setFlag(id, "pinned", true);
  });
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("sidebar inactivity configuration defaults and validates", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-settings-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  assert.equal(await readInactivityHours(file), 48);
  await writeFile(file, JSON.stringify({ sidebar: { inactivityHours: 2 } }));
  assert.equal(await readInactivityHours(file), 2);
  await writeFile(file, JSON.stringify({ sidebar: { inactivityHours: 0 } }));
  await assert.rejects(readInactivityHours(file), /Invalid Pagoda settings/u);
  await writeFile(file, JSON.stringify({ sidebar: { inactivityHours: 2, extra: true } }));
  await assert.rejects(readInactivityHours(file), /Invalid Pagoda settings/u);
});

test("backend exposes the configured inactivity period", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-settings-backend-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const settings = path.join(directory, "settings.json");
  await writeFile(settings, JSON.stringify({ sidebar: { inactivityHours: 2 } }));
  const backend = await startBackend({
    pi: fakePiLaunch(directory),
    port: 0,
    settingsFile: settings,
    stateFile: path.join(directory, "state.json"),
  });
  try {
    const token = new URLSearchParams(new URL(backend.connectionUrl).hash.slice(1)).get("token");
    assert.ok(token);
    const auth = await fetch(`${backend.origin}/api/auth`, {
      method: "POST",
      headers: {
        origin: backend.origin,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    const cookie = auth.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie);
    const response = await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } });
    const state: unknown = await response.json();
    assert.ok(state !== null && typeof state === "object" && "inactivityHours" in state);
    assert.equal(state.inactivityHours, 2);
  } finally {
    await backend.close();
  }
});

test("workspace restores pins and favourites without reopening the session", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-marks-restart-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  const first = new DesktopWorkspace(fakePiLaunch(directory), new SessionMetadataStore(file));
  await first.start();
  const key = first.initialKey;
  await first.prompt({ key, message: "retained session", mode: "prompt" });
  const [stored] = await first.list(directory);
  assert.ok(stored);
  await first.setMetadataFlag(stored.id, "pinned", true);
  await first.setMetadataFlag(stored.id, "favourite", true);
  await first.close();

  const second = new DesktopWorkspace(fakePiLaunch(directory), new SessionMetadataStore(file));
  try {
    await second.start();
    assert.equal(second.snapshot().sessions.length, 1);
    const marks = second.snapshot().metadata.find((entry) => entry.id === stored.id);
    assert.equal(marks?.pinned, true);
    assert.equal(marks.favourite, true);
    assert.ok((await second.listAll()).some((session) => session.id === stored.id));
  } finally {
    await second.close();
  }
});
