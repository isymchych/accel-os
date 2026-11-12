import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import { observeWorkspace } from "../../src/backend/events.ts";
import { WorkspaceObservations } from "../../src/backend/observation.ts";
import type { SessionKey, SessionSnapshot, WorkspaceState } from "../../src/contracts/index.ts";
import { runScoped } from "./fixtures/helpers.ts";

const sessionSnapshot = (
  key: SessionKey,
  revision: number,
  execution: SessionSnapshot["execution"] = "running",
): SessionSnapshot => ({
  key,
  revision,
  execution,
  controlsRevision: 0,
  historyRevision: 0,
  connection: "connected",
  cwd: "/project",
  sessionId: null,
  sessionFile: null,
  name: key,
  messages: [],
  streaming: [],
  tools: [],
  activity: null,
  error: null,
  notice: null,
});

test("initial observation precedes updates and replays only changes after its snapshot", async () => {
  let resolve!: (value: { state: WorkspaceState; revision: number }) => void;
  const snapshot = new Promise<{ state: WorkspaceState; revision: number }>((done) => {
    resolve = done;
  });
  const started = Promise.withResolvers<undefined>();
  const observations = new WorkspaceObservations(() =>
    Effect.promise(() => {
      started.resolve(undefined);
      return snapshot;
    }),
  );
  const response = HttpServerResponse.toWeb(observeWorkspace(observations));
  assert.ok(response.body);
  const reader = response.body.getReader();
  await started.promise;
  observations.publish({ type: "account", value: "before" });
  const revision = observations.currentRevision();
  observations.publish({ type: "account", value: "after" });
  resolve({
    revision,
    state: {
      initialKey: "initial" as SessionKey,
      sessions: [],
      metadata: [],
      selectedAccount: "before",
      inactivityHours: 48,
    },
  });
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('event: account\ndata: "after"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value);
  }
  assert.ok(text.startsWith("event: ready\n"));
  assert.doesNotMatch(text, /event: account\ndata: "before"/u);
  await reader.cancel();
  observations.close();
});

test("cancelling an observer interrupts its pending initial snapshot", async () => {
  const started = Promise.withResolvers<undefined>();
  const interrupted = Promise.withResolvers<undefined>();
  const observations = new WorkspaceObservations(() =>
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
  );
  const response = HttpServerResponse.toWeb(observeWorkspace(observations));
  assert.ok(response.body);
  const reader = response.body.getReader();
  await started.promise;
  await reader.cancel();
  await interrupted.promise;
  observations.close();
});

test("a slow observer retains the latest update for every session and workspace field", async (t) => {
  const state: WorkspaceState = {
    initialKey: "a" as SessionKey,
    sessions: [],
    metadata: [],
    selectedAccount: null,
    inactivityHours: 48,
  };
  const observations = new WorkspaceObservations(() =>
    Effect.succeed({ state, revision: observations.currentRevision() }),
  );
  t.after(() => {
    observations.close();
  });
  const { changes } = await runScoped(t, observations.observe());
  for (let revision = 1; revision <= 100; revision += 1) {
    for (const key of ["a", "b"] as SessionKey[]) {
      observations.publish({ type: "snapshot", value: sessionSnapshot(key, revision) });
    }
    observations.publish({ type: "metadata", value: [] });
    observations.publish({ type: "account", value: String(revision) });
  }
  const events = await Effect.runPromise(changes.pipe(Stream.take(4), Stream.runCollect));
  assert.deepEqual(
    events
      .filter((event) => event.type === "snapshot")
      .map((event) => [event.value.key, event.value.revision]),
    [
      ["a", 100],
      ["b", 100],
    ],
  );
  assert.deepEqual(
    events.filter((event) => event.type !== "snapshot"),
    [
      { type: "metadata", value: [] },
      { type: "account", value: "100" },
    ],
  );
});

test("a ready observer sees fast execution transitions without waiting for another task", async (t) => {
  const key = "a" as SessionKey;
  const state: WorkspaceState = {
    initialKey: key,
    sessions: [],
    metadata: [],
    selectedAccount: null,
    inactivityHours: 48,
  };
  const observations = new WorkspaceObservations(() => Effect.succeed({ state, revision: 0 }));
  const { changes } = await runScoped(t, observations.observe());
  const received = Effect.runPromise(
    changes.pipe(
      Stream.takeUntil((event) => event.type === "account"),
      Stream.runCollect,
    ),
  );
  for (const [index, execution] of (["idle", "running", "idle"] as const).entries()) {
    observations.publish({ type: "snapshot", value: sessionSnapshot(key, index, execution) });
  }
  observations.publish({ type: "account", value: "finished" });
  const events = await received;
  assert.deepEqual(
    events.filter((event) => event.type === "snapshot").map((event) => event.value.execution),
    ["idle", "running", "idle"],
  );
});

test("backend shutdown interrupts an observer still acquiring its initial snapshot", async () => {
  const started = Promise.withResolvers<undefined>();
  const interrupted = Promise.withResolvers<undefined>();
  const observations = new WorkspaceObservations(() =>
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
  );
  const response = HttpServerResponse.toWeb(observeWorkspace(observations));
  assert.ok(response.body);
  const reader = response.body.getReader();
  await started.promise;
  observations.close();
  assert.equal((await reader.read()).done, true);
  await interrupted.promise;
});
