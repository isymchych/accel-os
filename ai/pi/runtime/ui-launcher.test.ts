import assert from "node:assert/strict";
import test from "node:test";

import { uiLaunchArgs } from "./ui-launcher.ts";

test("desktop launch pins the existing profile and preserves the terminal environment", () => {
  const previous = { ...process.env };
  const args = uiLaunchArgs({ directory: "/profiles/selected account" }, "tilth");

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
    "desktop launch must not change the terminal environment",
  );
});
