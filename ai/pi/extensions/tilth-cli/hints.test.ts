import assert from "node:assert/strict";
import test from "node:test";

import { createTilthShellHint } from "./hints.ts";

const allTilthTools = new Set(["tilth_search", "tilth_read", "tilth_files", "tilth_grok"]);

test("createTilthShellHint maps rg and cat to Tilth tools", () => {
  assert.equal(
    createTilthShellHint("rg handleAuth src && cat src/auth.ts", allTilthTools),
    "Hint: for code exploration, prefer Tilth tools here: use tilth_search instead of rg/grep for code search; use tilth_read instead of cat for file contents.",
  );
});

test("createTilthShellHint handles piped find-style commands", () => {
  assert.equal(
    createTilthShellHint("fd auth | xargs grep token", allTilthTools),
    "Hint: for code exploration, prefer Tilth tools here: use tilth_search instead of rg/grep for code search; use tilth_files instead of find/fd for file discovery.",
  );
});

test("createTilthShellHint skips unavailable Tilth tools", () => {
  assert.equal(createTilthShellHint("cat README.md", new Set(["tilth_search"])), undefined);
});

test("createTilthShellHint ignores unrelated shell commands", () => {
  assert.equal(createTilthShellHint("git status", allTilthTools), undefined);
});
