import assert from "node:assert/strict";
import test from "node:test";

import { createSrcwalkShellHint } from "./hints.ts";

const allTools = new Set(["srcwalk_read", "srcwalk_discover", "srcwalk_review"]);

test("routes shell search, reads, listing, and structural review", () => {
  assert.equal(
    createSrcwalkShellHint(
      "rg auth src && head -40 src/auth.ts && find src -type f && git diff --cached",
      allTools,
    ),
    "Hint: for code exploration, prefer srcwalk tools here: use srcwalk_discover for structural or text discovery; use srcwalk_read for bounded source reads; use srcwalk_discover with kind=file for file discovery; use srcwalk_review for structural change review; use git diff --patch only for exact patch text.",
  );
});

test("ignores unavailable tools and unrelated commands", () => {
  assert.equal(createSrcwalkShellHint("cat README.md", new Set(["srcwalk_discover"])), undefined);
  assert.equal(createSrcwalkShellHint("git status", allTools), undefined);
});
