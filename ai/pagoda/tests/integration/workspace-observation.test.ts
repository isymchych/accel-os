import assert from "node:assert/strict";
import test from "node:test";

import type { SessionKey, SessionSnapshot } from "../../src/contracts/index.ts";
import { applySessionUpdate } from "../../src/renderer/http-api.ts";
import { mergeObservation } from "../../src/renderer/use-workspace-observation.ts";
import { contentText } from "./fixtures/helpers.ts";

const key = "owner-a" as SessionKey;
const otherKey = "owner-b" as SessionKey;

function snapshot(revision: number, text: string, sessionKey = key): SessionSnapshot {
  return {
    key: sessionKey,
    revision,
    connection: "connected",
    execution: "idle",
    cwd: "/project",
    sessionId: null,
    sessionFile: null,
    name: text,
    controlsRevision: 0,
    historyRevision: 0,
    messages: [{ role: "assistant", content: [{ type: "text", text }], isError: false }],
    streaming: [],
    tools: [],
    activity: null,
    error: null,
    notice: null,
  };
}

test("workspace initialization preserves newer command results and fills other sessions", () => {
  const live = snapshot(4, "live");
  const observed = mergeObservation({}, { type: "snapshot", snapshot: live });
  const result = mergeObservation(observed, {
    type: "workspace",
    workspace: {
      initialKey: key,
      sessions: [snapshot(2, "stale"), snapshot(1, "other", otherKey)],
      metadata: [],
      selectedAccount: null,
      inactivityHours: 48,
    },
  });
  assert.equal(contentText(result[key]?.messages[0]?.content), "live");
  assert.equal(contentText(result[otherKey]?.messages[0]?.content), "other");
});

test("late command snapshots cannot overwrite newer streaming observations", () => {
  const observed = mergeObservation({}, { type: "snapshot", snapshot: snapshot(4, "new") });
  const result = mergeObservation(observed, { type: "snapshot", snapshot: snapshot(2, "old") });
  assert.equal(result, observed);
  assert.equal(contentText(result[key]?.messages[0]?.content), "new");
});

test("account observations do not change session snapshots", () => {
  const observed = mergeObservation({}, { type: "snapshot", snapshot: snapshot(4, "live") });
  assert.equal(mergeObservation(observed, { type: "account", profile: "second" }), observed);
});

test("streaming updates preserve unchanged history and reject missing or stale baselines", () => {
  const previous = snapshot(4, "history");
  const update = {
    key,
    revision: 5,
    changes: { streaming: [{ type: "text" as const, text: "new" }] },
  };
  const next = applySessionUpdate(previous, update);
  assert.equal(next.messages, previous.messages);
  assert.equal(next.streaming[0]?.type, "text");
  assert.throws(() => applySessionUpdate(undefined, update), /Invalid session update/u);
  assert.throws(() => applySessionUpdate(next, update), /Invalid session update/u);
});
