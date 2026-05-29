import assert from "node:assert/strict";
import test from "node:test";

import {
  countLines,
  createDraftStack,
  getGlobalDraftStack,
  popDraft,
  previewDraft,
  pushDraft,
  resetGlobalDraftStack,
  removeDraft,
  setGlobalDraftStack,
} from "./stack.ts";

test.afterEach(() => {
  resetGlobalDraftStack();
});

test("pushDraft pushes newest drafts to the front", () => {
  let stack = createDraftStack();
  stack = pushDraft(stack, "first");
  stack = pushDraft(stack, "second");

  assert.deepEqual(
    stack.items.map((item) => item.text),
    ["second", "first"],
  );
  assert.equal(stack.nextId, 3);
});

test("popDraft removes and returns the most recent draft", () => {
  let stack = createDraftStack();
  stack = pushDraft(stack, "first");
  stack = pushDraft(stack, "second");

  const result = popDraft(stack);

  assert.equal(result.item?.text, "second");
  assert.deepEqual(
    result.stack.items.map((item) => item.text),
    ["first"],
  );
});

test("removeDraft removes a chosen draft without disturbing the rest", () => {
  let stack = createDraftStack();
  stack = pushDraft(stack, "first");
  stack = pushDraft(stack, "second");
  stack = pushDraft(stack, "third");

  const targetId = stack.items[1]?.id;
  assert.notEqual(targetId, undefined);
  if (targetId === undefined) {
    throw new Error("missing target id");
  }

  const result = removeDraft(stack, targetId);

  assert.equal(result.item?.text, "second");
  assert.deepEqual(
    result.stack.items.map((item) => item.text),
    ["third", "first"],
  );
});

test("previewDraft returns the first non-empty trimmed line", () => {
  assert.equal(previewDraft("\n   \n  hello world  \nnext line"), "hello world");
  assert.equal(previewDraft("\n\n"), "(empty draft)");
});

test("countLines counts newline-separated lines", () => {
  assert.equal(countLines("one"), 1);
  assert.equal(countLines("one\ntwo\nthree"), 3);
});

test("global draft stack survives repeated reads and explicit replacement", () => {
  const first = getGlobalDraftStack();
  const second = getGlobalDraftStack();

  assert.equal(first, second);

  const replaced = pushDraft(createDraftStack(), "saved");
  setGlobalDraftStack(replaced);

  assert.equal(getGlobalDraftStack(), replaced);
});
