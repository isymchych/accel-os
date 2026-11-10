import assert from "node:assert/strict";
import test from "node:test";

import { uiLaunchEnvironment } from "./ui-launcher.ts";

test("desktop launch pins the existing profile and preserves the terminal environment", () => {
  const previous = { ...process.env };
  const env = uiLaunchEnvironment("/repo", { directory: "/profiles/selected" }, "tilth");

  assert.equal(env["ACCEL_OS"], "/repo");
  assert.equal(env["AI_UI_PROFILE_DIR"], "/profiles/selected");
  assert.equal(env["AI_UI_CODE_NAVIGATION"], "tilth");
  assert.equal(env["AI_UI_CWD"], process.env["AI_CWD"] ?? process.cwd());
  assert.ok(
    Object.keys(process.env).length === Object.keys(previous).length &&
      Object.entries(previous).every(([name, value]) => process.env[name] === value),
    "desktop launch must not change the terminal environment",
  );
});
