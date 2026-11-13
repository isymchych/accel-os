import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Schema as S } from "effect";
import { AtomRegistry } from "effect/reactivity";

import { OperationFailed } from "../../src/contracts/errors.ts";
import { TargetSchema } from "../../src/contracts/index.ts";
import { createComposerAtoms } from "../../src/renderer/session/composer-state.ts";

const a = S.decodeUnknownSync(TargetSchema)({ key: "owner-a" }).key;
const b = S.decodeUnknownSync(TargetSchema)({ key: "owner-b" }).key;

function storage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

test("submissions stay with their owner and preserve a newer history draft", async (t) => {
  const store = storage();
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const response = Promise.withResolvers<string>();
  let calls = 0;
  const composers = createComposerAtoms(store, (request) => {
    calls += 1;
    assert.deepEqual(request, { key: a, message: "original", mode: "prompt" });
    return Effect.promise(() => response.promise);
  });
  registry.set(composers(a).edit, { message: "original" });
  registry.set(composers(b).edit, { message: "other" });
  registry.set(composers(a).submit, "prompt");
  registry.set(composers(a).submit, "prompt");
  assert.equal(calls, 1);
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  assert.equal(registry.get(composers(b).state).message, "other");
  registry.set(composers(a).edit, { message: "restored", fromHistory: true });
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  response.resolve("started");
  await response.promise;
  assert.equal(registry.get(composers(a).state).message, "restored");
  assert.equal(registry.get(composers(a).state).pending, false);
  assert.equal(store.getItem("pi-composer:owner-a"), "restored");
  assert.equal(store.getItem("pi-submitting:owner-a"), null);
});

test("reload preserves an uncertain draft without resending and failure retains it", async (t) => {
  const store = storage();
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const response = Promise.withResolvers<string>();
  let calls = 0;
  const composers = createComposerAtoms(store, () => {
    calls += 1;
    return Effect.tryPromise({
      try: () => response.promise,
      catch: () => new OperationFailed({ error: "Request failed" }),
    });
  });
  registry.set(composers(a).edit, { message: "keep me" });
  registry.set(composers(a).submit, "follow_up");
  const reloaded = createComposerAtoms(store, () => {
    throw new Error("Must not resend");
  });
  const restored = registry.get(reloaded(a).state);
  assert.equal(restored.message, "keep me");
  assert.equal(restored.pending, false);
  assert.match(restored.feedback?.message ?? "", /uncertain/u);
  response.reject(new Error("Request failed"));
  await assert.rejects(response.promise, /Request failed/u);
  const failed = registry.get(composers(a).state);
  assert.equal(failed.message, "keep me");
  assert.equal(failed.feedback?.message, "Request failed");
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  assert.equal(calls, 1);
  registry.set(composers(a).edit, { message: "edited" });
  assert.equal(registry.get(composers(a).state).feedback, null);
});

test("acknowledgement clears only the submitted draft", async (t) => {
  const store = storage();
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const response = Promise.withResolvers<string>();
  const composers = createComposerAtoms(store, () => Effect.promise(() => response.promise));
  registry.set(composers(a).edit, { message: "send me" });
  registry.set(composers(b).edit, { message: "keep me" });
  registry.set(composers(a).submit, "prompt");
  response.resolve("queued");
  await response.promise;
  assert.equal(registry.get(composers(a).state).message, "");
  assert.equal(store.getItem("pi-submitting:owner-a"), null);
  assert.equal(registry.get(composers(b).state).message, "keep me");
});

test("disposing during submission retains uncertainty and ignores a late acknowledgement", async () => {
  const store = storage();
  const registry = AtomRegistry.make();
  const response = Promise.withResolvers<string>();
  let calls = 0;
  const composers = createComposerAtoms(store, () => {
    calls += 1;
    return Effect.tryPromise({
      try: () => response.promise,
      catch: () => new OperationFailed({ error: "Request failed" }),
    });
  });
  registry.set(composers(a).edit, { message: "keep me" });
  registry.set(composers(a).submit, "prompt");
  assert.equal(calls, 1);
  registry.dispose();
  response.resolve("started");
  await response.promise;
  await Promise.resolve();
  assert.equal(store.getItem("pi-composer:owner-a"), "keep me");
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  const restoredRegistry = AtomRegistry.make();
  const restored = restoredRegistry.get(
    createComposerAtoms(store, () => Effect.die("Must not resend"))(a).state,
  );
  restoredRegistry.dispose();
  assert.match(restored.feedback?.message ?? "", /uncertain/u);
});

test("editing one owner's draft does not notify another composer or unchanged draft presence", (t) => {
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const composers = createComposerAtoms(storage(), () => Effect.succeed("started"));
  registry.set(composers(a).edit, { message: "first draft" });
  let otherNotifications = 0;
  let presenceNotifications = 0;
  registry.subscribe(composers(b).state, () => {
    otherNotifications += 1;
  });
  registry.subscribe(composers(a).hasDraft, () => {
    presenceNotifications += 1;
  });
  registry.set(composers(a).edit, { message: "updated draft" });
  assert.equal(otherNotifications, 0);
  assert.equal(presenceNotifications, 0);
  registry.set(composers(a).edit, { message: "" });
  assert.equal(presenceNotifications, 1);
});
