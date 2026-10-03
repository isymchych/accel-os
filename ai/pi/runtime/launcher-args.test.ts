import assert from "node:assert/strict";
import test from "node:test";

import { parseLauncherArgs } from "./launcher-args.ts";

test("defaults to srcwalk without launcher modifiers", () => {
  assert.deepEqual(parseLauncherArgs([]), {
    codeNavigation: "srcwalk",
    passthrough: [],
    showHelp: false,
    useAccountSwitcher: false,
  });
});

test("parses leading launcher modifiers", () => {
  assert.deepEqual(parseLauncherArgs(["account", "srcwalk", "help", "--model", "gpt-5"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--model", "gpt-5"],
    showHelp: true,
    useAccountSwitcher: true,
  });
});

test("preserves unrecognized launcher modifiers as Pi arguments", () => {
  assert.deepEqual(parseLauncherArgs(["other", "mcp"]), {
    codeNavigation: "srcwalk",
    passthrough: ["other", "mcp"],
    showHelp: false,
    useAccountSwitcher: false,
  });
});

test("preserves modifier-like values after Pi arguments", () => {
  assert.deepEqual(parseLauncherArgs(["--name", "account", "help"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--name", "account", "help"],
    showHelp: false,
    useAccountSwitcher: false,
  });
});

test("preserves arguments after the Pi delimiter", () => {
  assert.deepEqual(parseLauncherArgs(["--", "account"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--", "account"],
    showHelp: false,
    useAccountSwitcher: false,
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
