import assert from "node:assert/strict";
import test from "node:test";

import { parseLauncherArgs } from "./launcher-args.ts";

test("parses leading launcher modifiers", () => {
  assert.deepEqual(parseLauncherArgs(["account", "srcwalk", "mcp", "help", "--model", "gpt-5"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--model", "gpt-5"],
    showHelp: true,
    useAccountSwitcher: true,
    useMcp: true,
  });
});

test("preserves unrecognized launcher modifiers as Pi arguments", () => {
  assert.deepEqual(parseLauncherArgs(["other", "mcp"]), {
    codeNavigation: "tilth",
    passthrough: ["other", "mcp"],
    showHelp: false,
    useAccountSwitcher: false,
    useMcp: false,
  });
});

test("preserves modifier-like values after Pi arguments", () => {
  assert.deepEqual(parseLauncherArgs(["--name", "account", "help"]), {
    codeNavigation: "tilth",
    passthrough: ["--name", "account", "help"],
    showHelp: false,
    useAccountSwitcher: false,
    useMcp: false,
  });
});

test("preserves arguments after the Pi delimiter", () => {
  assert.deepEqual(parseLauncherArgs(["--", "account"]), {
    codeNavigation: "tilth",
    passthrough: ["--", "account"],
    showHelp: false,
    useAccountSwitcher: false,
    useMcp: false,
  });
});

test("accepts an explicit tilth backend", () => {
  assert.equal(parseLauncherArgs(["tilth"]).codeNavigation, "tilth");
});

test("rejects conflicting code navigation backends", () => {
  assert.throws(
    () => parseLauncherArgs(["tilth", "srcwalk"]),
    /choose only one code navigation backend/,
  );
});
