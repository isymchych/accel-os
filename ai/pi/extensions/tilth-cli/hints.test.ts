import assert from "node:assert/strict";
import test from "node:test";

import { createTilthShellHint } from "./hints.ts";

const allTilthTools = new Set([
  "tilth_search",
  "tilth_read",
  "tilth_list",
  "tilth_grok",
  "tilth_diff",
]);

test("createTilthShellHint maps search and file-reading commands to Tilth tools", () => {
  const hint = createTilthShellHint("rg handleAuth src && head -80 src/auth.ts", allTilthTools);
  assert.ok(hint);
  assert.match(hint, /tilth_search.*code search/);
  assert.match(hint, /tilth_read.*file contents/);
  assert.match(hint, /scope.*absolute path/);
});

test("createTilthShellHint handles piped find-style commands", () => {
  const hint = createTilthShellHint("fd auth | xargs grep token", allTilthTools);
  assert.ok(hint);
  assert.match(hint, /tilth_search.*code search/);
  assert.match(hint, /tilth_list.*file discovery/);
});

test("createTilthShellHint maps directory listing commands to tilth_list", () => {
  const hint = createTilthShellHint("ls src && tree packages", allTilthTools);
  assert.ok(hint);
  assert.match(hint, /tilth_list.*file discovery/);
});

test("createTilthShellHint maps git discovery commands to Tilth tools with an external checkout path", () => {
  const hint = createTilthShellHint("git grep handleAuth && git ls-files src", allTilthTools);
  assert.ok(hint);
  assert.match(hint, /tilth_search.*code search/);
  assert.match(hint, /tilth_list.*file discovery/);
  assert.match(hint, /scope.*absolute path/);
});

test("createTilthShellHint routes structural diff review to tilth_diff", () => {
  const hint = createTilthShellHint("git --no-pager diff --cached", allTilthTools);
  assert.ok(hint);
  assert.match(hint, /tilth_diff.*structural change review/);
  assert.match(hint, /git diff --patch.*exact patch text/);
});

test("createTilthShellHint skips unavailable Tilth tools", () => {
  assert.equal(createTilthShellHint("cat README.md", new Set(["tilth_search"])), undefined);
});

test("createTilthShellHint ignores unrelated shell commands", () => {
  assert.equal(createTilthShellHint("git status", allTilthTools), undefined);
});
