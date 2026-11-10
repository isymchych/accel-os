import assert from "node:assert/strict";
import test from "node:test";

import { parseLauncherArgs } from "./launcher-args.ts";

test("defaults to srcwalk without launcher modifiers", () => {
  assert.deepEqual(parseLauncherArgs([]), {
    codeNavigation: "srcwalk",
    passthrough: [],
    showHelp: false,
    useAccountSwitcher: false,
    useUi: false,
  });
});

test("parses leading launcher modifiers", () => {
  assert.deepEqual(parseLauncherArgs(["account", "srcwalk", "help", "--model", "gpt-5"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--model", "gpt-5"],
    showHelp: true,
    useAccountSwitcher: true,
    useUi: false,
  });
});

test("preserves unrecognized launcher modifiers as Pi arguments", () => {
  assert.deepEqual(parseLauncherArgs(["other", "mcp"]), {
    codeNavigation: "srcwalk",
    passthrough: ["other", "mcp"],
    showHelp: false,
    useAccountSwitcher: false,
    useUi: false,
  });
});

test("preserves modifier-like values after Pi arguments", () => {
  assert.deepEqual(parseLauncherArgs(["--name", "account", "help"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--name", "account", "help"],
    showHelp: false,
    useAccountSwitcher: false,
    useUi: false,
  });
});

test("preserves arguments after the Pi delimiter", () => {
  assert.deepEqual(parseLauncherArgs(["--", "account"]), {
    codeNavigation: "srcwalk",
    passthrough: ["--", "account"],
    showHelp: false,
    useAccountSwitcher: false,
    useUi: false,
  });
});

test("accepts an explicit tilth backend", () => {
  assert.equal(parseLauncherArgs(["tilth"]).codeNavigation, "tilth");
});

test("rejects conflicting code navigation backends", () => {
  assert.throws(
    () => parseLauncherArgs(["tilth", "srcwalk"]),
    /choose only one code navigation backend/u,
  );
});

test("routes ui to the desktop without invoking account selection", () => {
  assert.deepEqual(parseLauncherArgs(["ui"]), {
    codeNavigation: "srcwalk",
    passthrough: [],
    showHelp: false,
    useAccountSwitcher: false,
    useUi: true,
  });
  assert.throws(() => parseLauncherArgs(["ui", "account"]), /select an account/u);
  assert.throws(
    () => parseLauncherArgs(["ui", "--model", "test"]),
    /does not accept Pi arguments/u,
  );
});
