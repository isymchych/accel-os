import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDepsArgs,
  buildFilesArgs,
  buildGrokArgs,
  buildReadArgs,
  buildSearchArgs,
} from "./tool.ts";

test("buildReadArgs includes optional switches before the path", () => {
  assert.deepEqual(
    buildReadArgs(
      {
        path: "src/auth.ts",
        scope: "packages/app",
        section: "44-89",
        full: true,
        budget: 400,
      },
      "/repo",
    ),
    [
      "--scope",
      "/repo/packages/app",
      "--budget",
      "400",
      "--section",
      "44-89",
      "--full",
      "src/auth.ts",
    ],
  );
});

test("buildSearchArgs defaults auto mode to expand=2", () => {
  assert.deepEqual(buildSearchArgs({ query: "handleAuth" }, "/repo"), ["--expand=2", "handleAuth"]);
});

test("buildSearchArgs forces literal text through a regex wrapper", () => {
  assert.deepEqual(
    buildSearchArgs({ query: "TODO: fix(this)", mode: "literal", scope: "src" }, "/repo"),
    ["--scope", "/repo/src", "--expand=2", "/(?:TODO: fix\\(this\\))/"],
  );
});

test("buildSearchArgs supports callers mode without losing default expansion", () => {
  assert.deepEqual(
    buildSearchArgs({ query: "handleAuth", mode: "callers", glob: "*.ts" }, "/repo"),
    ["--glob", "*.ts", "--callers", "--expand=2", "handleAuth"],
  );
});

test("buildFilesArgs keeps the glob as the trailing query", () => {
  assert.deepEqual(buildFilesArgs({ pattern: "src/**/*.ts", budget: 200 }, "/repo"), [
    "--budget",
    "200",
    "src/**/*.ts",
  ]);
});

test("buildDepsArgs uses the deps flag before the path", () => {
  assert.deepEqual(buildDepsArgs({ path: "src/auth.ts", scope: "src" }, "/repo"), [
    "--scope",
    "/repo/src",
    "--deps",
    "src/auth.ts",
  ]);
});

test("buildGrokArgs uses the grok subcommand", () => {
  assert.deepEqual(buildGrokArgs({ target: "AuthManager", scope: "src", full: true }, "/repo"), [
    "grok",
    "--scope",
    "/repo/src",
    "--full",
    "AuthManager",
  ]);
});
