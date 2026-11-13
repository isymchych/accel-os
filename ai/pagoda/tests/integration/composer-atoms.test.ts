import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Schema as S } from "effect";
import { AtomRegistry } from "effect/reactivity";

import { TargetSchema } from "../../src/contracts/index.ts";
import { createComposerAtoms } from "../../src/renderer/composer-atoms.ts";

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
  const composers = createComposerAtoms(store, (_registry, request) => {
    calls += 1;
    assert.deepEqual(request, { key: a, message: "original", mode: "prompt" });
    return Effect.promise(() => response.promise);
  });
  registry.set(composers.edit, { key: a, message: "original" });
  registry.set(composers.edit, { key: b, message: "other" });
  registry.set(composers.submit, { key: a, mode: "prompt" });
  registry.set(composers.submit, { key: a, mode: "prompt" });
  assert.equal(calls, 1);
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  assert.equal(composers.read(registry.get(composers.state), b).message, "other");
  registry.set(composers.edit, { key: a, message: "restored", fromHistory: true });
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  response.resolve("started");
  await response.promise;
  assert.equal(composers.read(registry.get(composers.state), a).message, "restored");
  assert.equal(composers.read(registry.get(composers.state), a).pending, false);
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
    return Effect.tryPromise({ try: () => response.promise, catch: (error) => error });
  });
  registry.set(composers.edit, { key: a, message: "keep me" });
  registry.set(composers.submit, { key: a, mode: "follow_up" });
  const reloaded = createComposerAtoms(store, () => {
    throw new Error("Must not resend");
  });
  const restored = reloaded.read({}, a);
  assert.equal(restored.message, "keep me");
  assert.equal(restored.pending, false);
  assert.match(restored.feedback?.message ?? "", /uncertain/u);
  response.reject(new Error("Request failed"));
  await assert.rejects(response.promise, /Request failed/u);
  const failed = composers.read(registry.get(composers.state), a);
  assert.equal(failed.message, "keep me");
  assert.equal(failed.feedback?.message, "Request failed");
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  assert.equal(calls, 1);
  registry.set(composers.edit, { key: a, message: "edited" });
  assert.equal(composers.read(registry.get(composers.state), a).feedback, null);
});

test("acknowledgement clears only the submitted draft", async (t) => {
  const store = storage();
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const response = Promise.withResolvers<string>();
  const composers = createComposerAtoms(store, () => Effect.promise(() => response.promise));
  registry.set(composers.edit, { key: a, message: "send me" });
  registry.set(composers.edit, { key: b, message: "keep me" });
  registry.set(composers.submit, { key: a, mode: "prompt" });
  response.resolve("queued");
  await response.promise;
  assert.equal(composers.read(registry.get(composers.state), a).message, "");
  assert.equal(store.getItem("pi-submitting:owner-a"), null);
  assert.equal(composers.read(registry.get(composers.state), b).message, "keep me");
});

test("disposing during submission retains uncertainty and ignores a late acknowledgement", async () => {
  const store = storage();
  const registry = AtomRegistry.make();
  const response = Promise.withResolvers<string>();
  let calls = 0;
  const composers = createComposerAtoms(store, () => {
    calls += 1;
    return Effect.tryPromise({ try: () => response.promise, catch: (error) => error });
  });
  registry.set(composers.edit, { key: a, message: "keep me" });
  registry.set(composers.submit, { key: a, mode: "prompt" });
  assert.equal(calls, 1);
  registry.dispose();
  response.resolve("started");
  await response.promise;
  await Promise.resolve();
  assert.equal(store.getItem("pi-composer:owner-a"), "keep me");
  assert.equal(store.getItem("pi-submitting:owner-a"), "pending");
  const restored = createComposerAtoms(store, () => Effect.die("Must not resend")).read({}, a);
  assert.match(restored.feedback?.message ?? "", /uncertain/u);
});
