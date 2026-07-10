import assert from "node:assert/strict";
import test from "node:test";

import { buildCommitArgs, parseCommitOptions } from "./commit_with_message.ts";

const message = "feat: add thing\n\nAdd thing.\n";

test("buildCommitArgs uses normal git commit by default", () => {
  assert.deepEqual(buildCommitArgs(message, parseCommitOptions([])), [
    "commit",
    "-m",
    "feat: add thing",
    "-m",
    "Add thing.",
  ]);
});

test("buildCommitArgs includes --no-verify when requested", () => {
  assert.deepEqual(buildCommitArgs(message, parseCommitOptions(["--no-verify"])), [
    "commit",
    "--no-verify",
    "-m",
    "feat: add thing",
    "-m",
    "Add thing.",
  ]);
});

test("parseCommitOptions rejects unknown arguments", () => {
  assert.throws(() => parseCommitOptions(["--oops"]), /unknown argument: --oops/);
});
