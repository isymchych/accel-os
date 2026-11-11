import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { SessionSnapshot } from "../../src/desktop-api.ts";
import { DesktopSession } from "../../src/electron/session.ts";

async function fixture(
  t: test.TestContext,
): Promise<{ session: DesktopSession; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-desktop-"));
  const session = new DesktopSession({
    executable: process.execPath,
    args: [path.resolve(import.meta.dirname, "fixtures/fake-pi.ts")],
    cwd: directory,
    env: { HOME: directory, FAKE_PI_STATE: directory },
  });
  t.after(async () => {
    await session.close();
    await rm(directory, { recursive: true, force: true });
  });
  await session.start();
  return { session, directory };
}

async function observe(
  session: DesktopSession,
  predicate: (snapshot: SessionSnapshot) => boolean,
): Promise<SessionSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Expected session state was not observed"));
    }, 5_000);
    const receive = (snapshot: SessionSnapshot): void => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(snapshot);
    };
    const unsubscribe = session.subscribe(receive);
    receive(session.snapshot());
  });
}

test("preserves Unicode JSONL and replaces partial text with the authoritative message", async (t) => {
  const { session } = await fixture(t);
  const finished = observe(session, (snapshot) =>
    snapshot.messages.some((message) => message.role === "assistant"),
  );
  const input = "hello \u2028 \u2029 ☕";
  await session.prompt(input);
  const snapshot = await finished;
  assert.deepEqual(
    snapshot.messages.map((message) => message.text),
    [input, "Hello from fake Pi."],
  );
  assert.equal(snapshot.streaming, "");
  assert.ok(session.snapshot().sessionId);
});

test("renderer subscription replacement does not interrupt work; Stop confirms tool termination", async (t) => {
  const { session, directory } = await fixture(t);
  const active = observe(session, (snapshot) => snapshot.activity === "Running harmless-wait");
  await session.prompt("hold");
  await active;
  const unsubscribe = session.subscribe(() => {});
  unsubscribe();
  assert.equal(session.snapshot().execution, "running");
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  process.kill(toolPid, 0);
  await session.stop();
  assert.equal(session.snapshot().execution, "idle");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});

test("shutdown closes stdin and cleans up active child work", async (t) => {
  const { session, directory } = await fixture(t);
  const active = observe(session, (snapshot) => snapshot.activity !== null);
  await session.prompt("hold");
  await active;
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  await session.close();
  assert.equal(await readFile(path.join(directory, "closed"), "utf8"), "clean");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});

test("unsupported dialogs are explicitly cancelled and do not hang command acceptance", async (t) => {
  const { session } = await fixture(t);
  await session.prompt("/dialog");
  assert.equal(
    session.snapshot().notice,
    "Pi requested a confirm dialog. It was cancelled because this dialog is not yet supported.",
  );
  assert.equal(session.snapshot().execution, "idle");
});

test("command rejection and unexpected child exit remain visible", async (t) => {
  const { session } = await fixture(t);
  await assert.rejects(session.prompt("reject"), /Rejected test prompt/u);
  assert.equal(session.snapshot().execution, "idle");
  const disconnected = observe(session, (snapshot) => snapshot.connection === "disconnected");
  await assert.rejects(session.prompt("crash"), /Pi exited/u);
  assert.equal((await disconnected).execution, "unknown");
});
