import assert from "node:assert/strict";
import test from "node:test";

import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type {
  SessionKey,
  SessionSnapshot,
  WorkspaceApi,
  WorkspaceObservation,
} from "../../src/contracts/index.ts";
import { applySessionUpdate } from "../../src/renderer/http-api.ts";
import { createWorkspaceAtoms, mergeObservation } from "../../src/renderer/workspace-atoms.ts";
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

test("one scoped subscription shares ordered state and refreshes only accepted completions", () => {
  let listener: (observation: WorkspaceObservation) => void = () => {};
  let connection: (connected: boolean) => void = () => {};
  let subscriptions = 0;
  let disposals = 0;
  let catalogReads = 0;
  const api: Pick<WorkspaceApi, "subscribe"> = {
    subscribe: (observe, status) => {
      subscriptions += 1;
      listener = observe;
      connection = status ?? ((): void => {});
      return () => {
        disposals += 1;
      };
    },
  };
  const catalog = Atom.make(() => {
    catalogReads += 1;
    return AsyncResult.success([]);
  });
  const workspace = createWorkspaceAtoms(api, { catalog });
  const registry = AtomRegistry.make();
  registry.mount(catalog);
  registry.mount(workspace.subscription);
  registry.mount(workspace.subscription);
  assert.equal(subscriptions, 1);
  listener({
    type: "workspace",
    workspace: {
      initialKey: key,
      sessions: [{ ...snapshot(4, "running"), execution: "running" }],
      metadata: [],
      selectedAccount: "first",
      inactivityHours: 48,
    },
  });
  connection(true);
  registry.set(workspace.receive, { type: "snapshot", snapshot: snapshot(3, "stale") });
  listener({ type: "snapshot", snapshot: snapshot(2, "stale completion") });
  assert.equal(registry.get(workspace.state).sessions[key]?.name, "running");
  assert.equal(catalogReads, 1);
  listener({ type: "snapshot", snapshot: snapshot(5, "complete") });
  assert.equal(registry.get(workspace.state).sessions[key]?.name, "complete");
  assert.equal(catalogReads, 2);
  listener({ type: "account", profile: "second" });
  connection(false);
  assert.equal(registry.get(workspace.state).selectedAccount, "second");
  assert.equal(registry.get(workspace.state).transportConnected, false);
  assert.equal(registry.get(workspace.state).sessions[key]?.name, "complete");
  listener({
    type: "workspace",
    workspace: {
      initialKey: key,
      sessions: [snapshot(1, "old"), snapshot(1, "other", otherKey)],
      metadata: [],
      selectedAccount: "second",
      inactivityHours: 48,
    },
  });
  assert.equal(registry.get(workspace.state).sessions[key]?.name, "complete");
  assert.equal(registry.get(workspace.state).sessions[otherKey]?.name, "other");
  registry.dispose();
  assert.equal(disposals, 1);
});
