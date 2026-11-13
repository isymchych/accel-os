import assert from "node:assert/strict";
import test from "node:test";

import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type {
  SessionKey,
  SessionControls,
  SessionHistory,
  SessionSnapshot,
  WorkspaceEvents,
  WorkspaceObservation,
} from "../../src/contracts/index.ts";
import { applySessionUpdate } from "../../src/renderer/transport/workspace-events.ts";
import {
  createWorkspaceAtoms,
  mergeObservation,
} from "../../src/renderer/workspace/workspace-state.ts";
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

test("accepted revisions invalidate only the affected owner's queries and keep unopened history lazy", (t) => {
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const controlsReads = new Map<SessionKey, number>();
  const historyReads = new Map<SessionKey, number>();
  const controls = Atom.family((owner: SessionKey) =>
    Atom.make(() => {
      controlsReads.set(owner, (controlsReads.get(owner) ?? 0) + 1);
      return AsyncResult.success<SessionControls>({
        models: [],
        model: null,
        thinkingLevel: "off",
        levels: [],
        pendingMessageCount: 0,
      });
    }),
  );
  const history = Atom.family((owner: SessionKey) =>
    Atom.make(() => {
      historyReads.set(owner, (historyReads.get(owner) ?? 0) + 1);
      return AsyncResult.success<SessionHistory>({ entries: [], leafId: null });
    }),
  );
  const workspace = createWorkspaceAtoms(
    { subscribe: () => (): void => {} },
    {
      catalog: Atom.make(AsyncResult.success([])),
      accounts: Atom.make(AsyncResult.success([])),
    },
    { controls, history },
  );
  const receive = (value: SessionSnapshot): void => {
    workspace.receive(registry, { type: "snapshot", snapshot: value });
  };
  receive(snapshot(1, "A"));
  receive(snapshot(1, "B", otherKey));
  registry.mount(controls(key));
  registry.mount(controls(otherKey));
  receive({ ...snapshot(2, "A"), controlsRevision: 1, historyRevision: 1 });
  assert.equal(controlsReads.get(key), 2);
  assert.equal(controlsReads.get(otherKey), 1);
  assert.equal(historyReads.size, 0, "Invalidation must not fetch unviewed history");
  registry.mount(history(key));
  assert.equal(historyReads.get(key), 1);
  receive({ ...snapshot(3, "A"), controlsRevision: 1, historyRevision: 2 });
  assert.equal(historyReads.get(key), 2);
  assert.equal(controlsReads.get(key), 2);
  receive({ ...snapshot(2, "stale"), controlsRevision: 99, historyRevision: 99 });
  assert.equal(historyReads.get(key), 2);
  assert.equal(controlsReads.get(key), 2);

  workspace.receive(registry, {
    type: "workspace",
    workspace: {
      sessions: [{ ...snapshot(3, "A"), controlsRevision: 1, historyRevision: 2 }],
      initialKey: key,
      selectedAccount: null,
      metadata: [],
      inactivityHours: 48,
    },
  });
  assert.equal(
    historyReads.get(key),
    3,
    "Reconnect refreshes mounted history even at the same revision",
  );
  assert.equal(controlsReads.get(key), 3);
  assert.equal(controlsReads.get(otherKey), 1);
});

test("streaming in another owner does not notify the selected session or sidebar summaries", (t) => {
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const workspace = createWorkspaceAtoms(
    { subscribe: () => (): void => {} },
    {
      catalog: Atom.make(AsyncResult.success([])),
      accounts: Atom.make(AsyncResult.success([])),
    },
    {
      controls: Atom.family(() => Atom.make(AsyncResult.initial<SessionControls>())),
      history: Atom.family(() => Atom.make(AsyncResult.initial<SessionHistory>())),
    },
  );
  workspace.receive(registry, { type: "connection", connected: true });
  workspace.receive(registry, { type: "snapshot", snapshot: snapshot(1, "A") });
  workspace.receive(registry, { type: "snapshot", snapshot: snapshot(1, "B", otherKey) });
  let selectedNotifications = 0;
  let sidebarNotifications = 0;
  registry.subscribe(workspace.session(key), () => {
    selectedNotifications += 1;
  });
  registry.subscribe(workspace.summaries, () => {
    sidebarNotifications += 1;
  });
  workspace.receive(registry, {
    type: "snapshot",
    snapshot: {
      ...snapshot(2, "B", otherKey),
      streaming: [{ type: "text", text: "more output" }],
    },
  });
  assert.equal(selectedNotifications, 0);
  assert.equal(sidebarNotifications, 0);
  workspace.receive(registry, { type: "connection", connected: false });
  assert.equal(registry.get(workspace.session(key))?.execution, "unknown");
  assert.equal(selectedNotifications, 1);
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
  const api: WorkspaceEvents = {
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
  const workspace = createWorkspaceAtoms(
    api,
    {
      catalog,
      accounts: Atom.make(AsyncResult.success([])),
    },
    {
      history: Atom.family(() => Atom.make(AsyncResult.success({ entries: [], leafId: null }))),
      controls: Atom.family(() =>
        Atom.make(
          AsyncResult.success({
            models: [],
            model: null,
            thinkingLevel: "off",
            levels: [],
            pendingMessageCount: 0,
          }),
        ),
      ),
    },
  );
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
  workspace.receive(registry, { type: "snapshot", snapshot: snapshot(3, "stale") });
  listener({ type: "snapshot", snapshot: snapshot(2, "stale completion") });
  assert.equal(registry.get(workspace.state).sessions[key]?.name, "running");
  assert.equal(catalogReads, 2);
  listener({ type: "snapshot", snapshot: snapshot(5, "complete") });
  assert.equal(registry.get(workspace.state).sessions[key]?.name, "complete");
  assert.equal(catalogReads, 3);
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
