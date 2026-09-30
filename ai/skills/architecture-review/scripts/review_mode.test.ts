import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewMode } from "./review_mode.ts";

test("parseReviewMode accepts each documented mode", () => {
  assert.deepEqual(parseReviewMode([]), { kind: "workspace" });
  assert.deepEqual(parseReviewMode(["--staged"]), { kind: "staged" });
  assert.deepEqual(parseReviewMode(["--base", "origin/main"]), {
    kind: "base",
    baseRef: "origin/main",
  });
});
