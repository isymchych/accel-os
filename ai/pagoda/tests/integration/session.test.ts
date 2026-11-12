import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Effect } from "effect";

import { DesktopSession } from "../../src/backend/session.ts";
import type { SessionSnapshot } from "../../src/contracts/index.ts";
import { runScoped } from "./fixtures/helpers.ts";
import {
  contentText,
  fakePiOptions,
  fakeSessionFactory,
  waitForSession,
} from "./fixtures/helpers.ts";

async function fixture(
  t: test.TestContext,
): Promise<{ session: DesktopSession; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-desktop-"));
  const session = await runScoped(
    t,
    DesktopSession.make(fakePiOptions(directory), fakeSessionFactory),
  );
  t.after(async () => {
    await Effect.runPromise(session.close());
    await rm(directory, { recursive: true, force: true });
  });

  return { session, directory };
}

const observe = (
  session: DesktopSession,
  predicate: Parameters<typeof waitForSession>[1],
): Promise<SessionSnapshot> =>
  waitForSession(session, predicate, {
    timeout: 5_000,
    description: "Expected session state was not observed",
  });

test("preserves Unicode SDK content and replaces partial text with the authoritative message", async (t) => {
  const { session } = await fixture(t);
  const finished = observe(session, (snapshot) =>
    snapshot.messages.some((message) => message.role === "assistant"),
  );
  const input = "hello \u2028 \u2029 ☕";
  await Effect.runPromise(session.prompt(input));
  const snapshot = await finished;
  assert.deepEqual(
    snapshot.messages.map((message) => contentText(message.content)),
    [input, "Hello from fake Pi."],
  );
  assert.deepEqual(snapshot.streaming, []);
  assert.ok(session.snapshot().sessionId);
});

test("renderer subscription replacement does not interrupt work; Stop confirms tool termination", async (t) => {
  const { session, directory } = await fixture(t);
  const active = observe(session, (snapshot) => snapshot.activity === "Running harmless-wait");
  await Effect.runPromise(session.prompt("hold"));
  await active;
  const unsubscribe = session.subscribe(() => {});
  unsubscribe();
  assert.equal(session.snapshot().execution, "running");
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  process.kill(toolPid, 0);
  await Effect.runPromise(session.stop());
  assert.equal(session.snapshot().execution, "idle");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});

test("shutdown disposes the SDK owner and cleans up active tool work", async (t) => {
  const { session, directory } = await fixture(t);
  const active = observe(session, (snapshot) => snapshot.activity !== null);
  await Effect.runPromise(session.prompt("hold"));
  await active;
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  await Effect.runPromise(session.close());
  assert.equal(await readFile(path.join(directory, "closed"), "utf8"), "clean");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});

test("unsupported dialogs are explicitly cancelled and do not hang command acceptance", async (t) => {
  const { session } = await fixture(t);
  await Effect.runPromise(session.prompt("/dialog"));
  assert.equal(
    session.snapshot().notice,
    "Pi requested a confirm dialog. It was cancelled because this dialog is not yet supported.",
  );
  assert.equal(session.snapshot().execution, "idle");
});

test("SDK command rejections remain visible without disconnecting the owner", async (t) => {
  const { session } = await fixture(t);
  await assert.rejects(Effect.runPromise(session.prompt("reject")), /Rejected test prompt/u);
  assert.equal(session.snapshot().execution, "idle");
  await assert.rejects(
    Effect.runPromise(session.prompt("crash")),
    /Synthetic SDK execution failure/u,
  );
  assert.equal(session.snapshot().error, "Synthetic SDK execution failure");
  assert.equal(session.snapshot().connection, "connected");
});
