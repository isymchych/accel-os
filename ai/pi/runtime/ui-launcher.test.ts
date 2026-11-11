import assert from "node:assert/strict";
import test from "node:test";

import { serverLaunchArgs } from "./ui-launcher.ts";

test("backend launch pins the existing profile and preserves the terminal environment", () => {
  const previous = { ...process.env };
  const args = serverLaunchArgs({ directory: "/profiles/selected account" }, "tilth");

  assert.deepEqual(args, [
    "--cwd",
    process.env["AI_CWD"] ?? process.cwd(),
    "--profile-dir",
    "/profiles/selected account",
    "--code-navigation",
    "tilth",
  ]);
  assert.ok(
    Object.keys(process.env).length === Object.keys(previous).length &&
      Object.entries(previous).every(([name, value]) => process.env[name] === value),
    "backend launch must not change the terminal environment",
  );
});
