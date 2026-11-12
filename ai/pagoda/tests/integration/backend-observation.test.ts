import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";

import { observeWorkspace } from "../../src/backend/events.ts";
import { WorkspaceObservations } from "../../src/backend/observation.ts";
import type { SessionKey, WorkspaceState } from "../../src/contracts/index.ts";

test("initial observation precedes updates and replays only changes after its snapshot", async () => {
  let resolve!: (value: { state: WorkspaceState; revision: number }) => void;
  const snapshot = new Promise<{ state: WorkspaceState; revision: number }>((done) => {
    resolve = done;
  });
  const observations = new WorkspaceObservations(() => Effect.promise(() => snapshot));
  const response = HttpServerResponse.toWeb(
    observeWorkspace(observations, new AbortController().signal),
  );
  assert.ok(response.body);
  const reader = response.body.getReader();
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
  const response = HttpServerResponse.toWeb(
    observeWorkspace(observations, new AbortController().signal),
  );
  assert.ok(response.body);
  const reader = response.body.getReader();
  await started.promise;
  await reader.cancel();
  await interrupted.promise;
  observations.close();
});
