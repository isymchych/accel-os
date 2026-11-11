import assert from "node:assert/strict";
import test from "node:test";

import type { SessionKey, SessionSnapshot, SessionSummary } from "../../src/desktop-api.ts";
import { mergeObservation } from "../../src/renderer/use-workspace-observation.ts";

const key = "owner-a" as SessionKey;
const otherKey = "owner-b" as SessionKey;

function summary(revision: number, name: string, sessionKey = key): SessionSummary {
  return {
    key: sessionKey,
    revision,
    connection: "connected",
    execution: "idle",
    cwd: "/project",
    sessionId: null,
    sessionFile: null,
    name,
  };
}
function snapshot(revision: number, text: string): SessionSnapshot {
  return {
    ...summary(revision, text),
    runtimeRevision: 0,
    messages: [{ role: "assistant", text, isError: false }],
    streaming: "",
    tools: [],
    activity: null,
    error: null,
    notice: null,
  };
}

test("late workspace summaries preserve newer observations and other sessions", () => {
  const live = snapshot(4, "live");
  const observed = mergeObservation({}, { type: "snapshot", snapshot: live });
  const result = mergeObservation(observed, {
    type: "summaries",
    sessions: [summary(2, "stale"), summary(1, "other", otherKey)],
  });
  assert.equal(result[key]?.summary.name, "live");
  assert.equal(result[key].snapshot?.messages[0]?.text, "live");
  assert.equal(result[otherKey]?.summary.name, "other");
});

test("late snapshots cannot overwrite newer transcript or summary", () => {
  const observed = mergeObservation({}, { type: "snapshot", snapshot: snapshot(4, "new") });
  const result = mergeObservation(observed, { type: "snapshot", snapshot: snapshot(2, "old") });
  assert.equal(result[key]?.summary.name, "new");
  assert.equal(result[key].snapshot?.messages[0]?.text, "new");
});

test("newer summaries preserve snapshots and older snapshots can still fill missing content", () => {
  const observed = mergeObservation({}, { type: "snapshot", snapshot: snapshot(2, "transcript") });
  const newerSummary = mergeObservation(observed, {
    type: "summaries",
    sessions: [summary(5, "newer summary"), summary(5, "other", otherKey)],
  });
  assert.equal(newerSummary[key]?.summary.name, "newer summary");
  assert.equal(newerSummary[key].snapshot?.messages[0]?.text, "transcript");

  const onlySummary = mergeObservation({}, { type: "summaries", sessions: [summary(5, "latest")] });
  const filled = mergeObservation(onlySummary, {
    type: "snapshot",
    snapshot: snapshot(3, "history"),
  });
  assert.equal(filled[key]?.summary.name, "latest");
  assert.equal(filled[key].snapshot?.messages[0]?.text, "history");
});
