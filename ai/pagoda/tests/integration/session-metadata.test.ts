import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

import { startBackend } from "../../src/backend/server.ts";
import { SessionMetadataStore } from "../../src/backend/session-metadata.ts";
import { readInactivityHours } from "../../src/backend/settings.ts";
import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import type { SessionId } from "../../src/contracts/index.ts";
import { runScoped } from "./fixtures/helpers.ts";
import { fakePiOptions, fakeSessionFactory, setupFakePi } from "./fixtures/helpers.ts";

const fs = await Effect.runPromise(
  FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)),
);

test("session metadata persists independent flags", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-metadata-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  const store = new SessionMetadataStore(fs, file);
  const id = "example-session" as SessionId;
  await Promise.all([
    Effect.runPromise(store.setFlag(id, "pinned", true)),
    Effect.runPromise(store.setFlag(id, "favourite", true)),
  ]);

  const reopened = new SessionMetadataStore(fs, file);
  assert.deepEqual(await Effect.runPromise(reopened.list()), [
    { id, pinned: true, favourite: true },
  ]);
  await Effect.runPromise(reopened.setFlag(id, "pinned", false));
  assert.deepEqual(await Effect.runPromise(store.list()), [{ id, pinned: false, favourite: true }]);
  assert.deepEqual(
    JSON.parse(await readFile(file, "utf8")),
    await Effect.runPromise(reopened.list()),
  );
  await writeFile(file, JSON.stringify([{ id, pinned: true, favourite: false, lastActivity: 10 }]));
  assert.deepEqual(await Effect.runPromise(reopened.list()), [
    { id, pinned: true, favourite: false },
  ]);
  await Effect.runPromise(reopened.setFlag(id, "favourite", true));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), [
    { id, pinned: true, favourite: true },
  ]);
  await writeFile(file, "{broken");
  await assert.rejects(Effect.runPromise(reopened.setFlag(id, "pinned", true)));
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("sidebar inactivity configuration defaults and validates", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-settings-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "settings.json");
  const readSettings = (): Promise<number> =>
    Effect.runPromise(
      readInactivityHours(file).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
    );
  assert.equal(await readSettings(), 48);
  await writeFile(file, JSON.stringify({ sidebar: { inactivityHours: 2 } }));
  assert.equal(await readSettings(), 2);
  await writeFile(file, JSON.stringify({ sidebar: { inactivityHours: 0 } }));
  await assert.rejects(readSettings(), /Invalid Pagoda settings/u);
  await writeFile(file, JSON.stringify({ sidebar: { inactivityHours: 2, extra: true } }));
  await assert.rejects(readSettings(), /Invalid Pagoda settings/u);
});

test("backend exposes the configured inactivity period", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-settings-backend-"));
  await setupFakePi(directory);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const settings = path.join(fakePiOptions(directory).agentDir, "pagoda-settings.json");
  await writeFile(settings, JSON.stringify({ sidebar: { inactivityHours: 2 } }));
  const backend = await startBackend({
    pi: fakePiOptions(directory),
    sessionFactory: fakeSessionFactory,
    port: 0,
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
  await setupFakePi(directory);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  const first = await runScoped(
    t,
    DesktopWorkspace.make(
      fakePiOptions(directory),
      new SessionMetadataStore(fs, file),
      48,
      fakeSessionFactory,
    ),
  );

  const key = first.initialKey;
  await Effect.runPromise(first.prompt({ key, message: "retained session", mode: "prompt" }));
  const [stored] = await Effect.runPromise(first.list(directory));
  assert.ok(stored);
  await Effect.runPromise(first.setMetadataFlag(stored.id, "pinned", true));
  await Effect.runPromise(first.setMetadataFlag(stored.id, "favourite", true));
  await Effect.runPromise(first.close());

  const second = await runScoped(
    t,
    DesktopWorkspace.make(
      fakePiOptions(directory),
      new SessionMetadataStore(fs, file),
      48,
      fakeSessionFactory,
    ),
  );
  try {
    const snapshot = await Effect.runPromise(second.snapshot());
    assert.equal(snapshot.sessions.length, 1);
    const marks = snapshot.metadata.find((entry) => entry.id === stored.id);
    assert.equal(marks?.pinned, true);
    assert.equal(marks.favourite, true);
    assert.ok(
      (await Effect.runPromise(second.listAll())).some((session) => session.id === stored.id),
    );
  } finally {
    await Effect.runPromise(second.close());
  }
});
