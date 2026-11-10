import assert from "node:assert/strict";
import test from "node:test";

import { createSrcwalkShellHint } from "./hints.ts";

const allTools = new Set(["srcwalk_read", "srcwalk_discover", "srcwalk_review"]);

test("routes shell search, reads, listing, and structural review", () => {
  const hint = createSrcwalkShellHint(
    "rg auth src && head -40 src/auth.ts && find src -type f && git diff --cached",
    allTools,
  );
  assert.ok(hint);
  assert.match(hint, /srcwalk_discover.*text discovery/u);
  assert.match(hint, /srcwalk_read.*source reads/u);
  assert.match(hint, /srcwalk_discover.*kind=file.*file discovery/u);
  assert.match(hint, /srcwalk_review.*structural change review/u);
});

test("ignores unavailable tools and unrelated commands", () => {
  assert.equal(createSrcwalkShellHint("cat README.md", new Set(["srcwalk_discover"])), undefined);
  assert.equal(createSrcwalkShellHint("git status", allTools), undefined);
});
