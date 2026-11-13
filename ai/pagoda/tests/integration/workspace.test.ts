import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Deferred, Effect, Fiber } from "effect";

import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import { runScoped } from "./fixtures/helpers.ts";
import {
  contentText,
  fakePiOptions,
  fakeSessionFactory,
  metadataStore,
  setupFakePi,
} from "./fixtures/helpers.ts";

async function fixture(
  t: test.TestContext,
): Promise<{ workspace: DesktopWorkspace; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-"));
  await setupFakePi(directory);
  const workspace = await runScoped(
    t,
    DesktopWorkspace.make(
      fakePiOptions(directory),
      await metadataStore(fakePiOptions(directory).agentDir),
      48,
      fakeSessionFactory,
    ),
  );
  t.after(async () => {
    try {
      await Effect.runPromise(workspace.close());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  return { workspace, directory };
}

test("reopening and navigation render native summary messages", async (t) => {
  const { workspace, directory } = await fixture(t);
  const native = path.join(directory, "native");
  const manager = SessionManager.create(directory, native);
  const first = manager.appendMessage({ role: "user", content: "retained", timestamp: 1 });
  const compact = manager.appendCompaction("Compacted history", first, 100);
  const branchId = manager.branchWithSummary(compact, "Previous branch");
  manager.appendCustomMessageEntry("fixture", "Latest", true);
  const file = manager.getSessionFile();
  assert.ok(file);

  const opened = await Effect.runPromise(workspace.open(directory, file));
  const session = await Effect.runPromise(workspace.session(opened.key));
  await assert.rejects(Effect.runPromise(session.prompt(" \n")), /Enter a message/u);
  const texts = opened.messages.map((message) => contentText(message.content));
  assert.ok(texts.includes("Compacted history"));
  assert.ok(texts.includes("Previous branch"));
  assert.equal(texts.at(-1), "Latest");
  const branch = (await Effect.runPromise(session.history())).entries.find(
    (entry) => entry.id === branchId,
  );
  assert.ok(branch);
  await Effect.runPromise(session.navigate(branch.id));
  assert.equal(contentText(session.snapshot().messages.at(-1)?.content), "Previous branch");
});

test("independent owners survive view changes, reopen deduplicates, and forks preserve active work", async (t) => {
  const { workspace, directory } = await fixture(t);
  const other = path.join(directory, "other");
  await mkdir(other);

  const a = await Effect.runPromise(workspace.session(workspace.initialKey));
  await Effect.runPromise(a.prompt("hold"));
  const b = await Effect.runPromise(workspace.create(other));
  assert.notEqual(a.summary().key, b.key);
  const ownerB = await Effect.runPromise(workspace.session(b.key));
  await Effect.runPromise(ownerB.prompt("B prompt"));
  const historyA = await Effect.runPromise(a.history());
  const entry = historyA.entries.find((item) => item.label.startsWith("user: hold"));
  assert.ok(entry);
  assert.equal(a.summary().execution, "running");
  const catalog = await Effect.runPromise(workspace.list(directory));
  assert.equal(catalog.length, 1);
  const all = await Effect.runPromise(workspace.listAll());
  assert.deepEqual(new Set(all.map((session) => session.cwd)), new Set([directory, other]));
  const stored = catalog[0];
  assert.ok(stored);
  const [first, second] = await Promise.all([
    Effect.runPromise(workspace.open(directory, stored.path)),
    Effect.runPromise(workspace.open(directory, stored.path)),
  ]);
  assert.equal(first.key, workspace.initialKey);
  assert.equal(second.key, first.key);
  assert.equal((await Effect.runPromise(workspace.snapshot())).sessions.length, 2);
  await assert.rejects(Effect.runPromise(workspace.open(other, stored.path)), /catalog/u);
  assert.equal(a.summary().execution, "running");

  const fork = await Effect.runPromise(workspace.fork(a.summary().key, entry.id));
  assert.notEqual(fork.sessionId, a.summary().sessionId);
  assert.equal(a.summary().execution, "running");
  assert.deepEqual(
    fork.messages.map((message) => contentText(message.content)),
    ["hold"],
  );
  const forkOwner = await Effect.runPromise(workspace.session(fork.key));
  await Effect.runPromise(forkOwner.prompt("fork prompt"));
  assert.equal(a.summary().execution, "running");
  await Effect.runPromise(a.prompt("later", "follow_up"));
  await Effect.runPromise(a.prompt("steering", "steer"));
  await Effect.runPromise(forkOwner.stop());
  assert.equal(a.summary().execution, "running", "Stop on the destination cannot stop its source");
  await Effect.runPromise(a.stop());
  assert.equal(a.summary().execution, "idle");
});

test("model and thinking changes invalidate history; delivered queue entries invalidate controls", async (t) => {
  const { workspace } = await fixture(t);

  const session = await Effect.runPromise(workspace.session(workspace.initialKey));
  let historyRevision = session.snapshot().historyRevision;
  await Effect.runPromise(session.model("fake", "other"));
  assert.ok(session.snapshot().historyRevision > historyRevision);
  historyRevision = session.snapshot().historyRevision;
  await Effect.runPromise(session.thinking("low"));
  assert.ok(session.snapshot().historyRevision > historyRevision);

  await Effect.runPromise(session.prompt("hold"));
  await Effect.runPromise(session.prompt("queued message", "follow_up"));
  assert.equal((await Effect.runPromise(session.controls())).pendingMessageCount, 1);
  const before = session.snapshot().controlsRevision;
  let deliveredRevision = 0;
  const unsubscribe = session.subscribe((snapshot) => {
    if (snapshot.messages.some((message) => contentText(message.content) === "queued message")) {
      deliveredRevision ||= snapshot.controlsRevision;
    }
  });
  await Effect.runPromise(session.prompt("__deliver_queued__", "steer"));
  unsubscribe();
  assert.ok(deliveredRevision > before, "Delivery itself invalidates controls");
  assert.equal((await Effect.runPromise(session.controls())).pendingMessageCount, 0);
  assert.equal(session.snapshot().execution, "running");
});

test("request cancellation leaves a backend command running until it completes", async (t) => {
  const { workspace } = await fixture(t);
  const started = Promise.withResolvers<undefined>();
  const finished = Promise.withResolvers<undefined>();
  const release = Deferred.makeUnsafe<undefined>();
  let completed = false;
  const request = Effect.runFork(
    workspace.command(
      Effect.sync(() => {
        started.resolve(undefined);
      }).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(
          Effect.sync(() => {
            completed = true;
            finished.resolve(undefined);
          }),
        ),
      ),
    ),
  );
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(request));
  assert.equal(completed, false);
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await finished.promise;
  assert.equal(completed, true);
});

test("backend shutdown interrupts commands even after their request has gone away", async (t) => {
  const { workspace } = await fixture(t);
  const started = Promise.withResolvers<undefined>();
  const interrupted = Promise.withResolvers<undefined>();
  const request = Effect.runFork(
    workspace.command(
      Effect.sync(() => {
        started.resolve(undefined);
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted.resolve(undefined);
          }),
        ),
      ),
    ),
  );
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(request));
  await Effect.runPromise(workspace.close());
  await interrupted.promise;
});
