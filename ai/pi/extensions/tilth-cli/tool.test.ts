import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDepsArgs,
  buildFilesArgs,
  buildGrokArgs,
  buildReadArgs,
  buildSearchArgs,
  prepareTilthReadInput,
  prepareTilthSearchInput,
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

test("buildReadArgs applies a small default budget", () => {
  assert.deepEqual(buildReadArgs({ path: "src/auth.ts" }, "/repo"), [
    "--budget",
    "12000",
    "src/auth.ts",
  ]);
});

test("buildSearchArgs defaults auto mode to a small budget and expand=2", () => {
  assert.deepEqual(buildSearchArgs({ query: "handleAuth" }, "/repo"), [
    "--budget",
    "10000",
    "--expand=2",
    "handleAuth",
  ]);
});

test("buildSearchArgs forces literal text through a regex wrapper", () => {
  assert.deepEqual(
    buildSearchArgs({ query: "TODO: fix(this)", mode: "literal", scope: "src" }, "/repo"),
    ["--scope", "/repo/src", "--budget", "10000", "--expand=2", "/(?:TODO: fix\\(this\\))/"],
  );
});

test("buildSearchArgs supports callers mode without losing default expansion", () => {
  assert.deepEqual(
    buildSearchArgs({ query: "handleAuth", mode: "callers", glob: "*.ts" }, "/repo"),
    ["--budget", "10000", "--glob", "*.ts", "--callers", "--expand=2", "handleAuth"],
  );
});

test("buildFilesArgs keeps the glob as the trailing query", () => {
  assert.deepEqual(buildFilesArgs({ pattern: "src/**/*.ts", budget: 200 }, "/repo"), [
    "--budget",
    "200",
    "src/**/*.ts",
  ]);
});

test("buildFilesArgs applies a small default budget", () => {
  assert.deepEqual(buildFilesArgs({ pattern: "src/**/*.ts" }, "/repo"), [
    "--budget",
    "8000",
    "src/**/*.ts",
  ]);
});

test("buildDepsArgs uses the deps flag before the path", () => {
  assert.deepEqual(buildDepsArgs({ path: "src/auth.ts", scope: "src" }, "/repo"), [
    "--scope",
    "/repo/src",
    "--budget",
    "12000",
    "--deps",
    "src/auth.ts",
  ]);
});

test("prepareTilthReadInput clamps large budgets", () => {
  assert.deepEqual(prepareTilthReadInput({ path: "src/auth.ts", budget: 50000 }), {
    input: { path: "src/auth.ts", budget: 15000 },
    warnings: [
      "tilth_read budget clamped from 50000 to 15000; use section, scope, glob, or a narrower query instead of large budgets.",
    ],
  });
});

test("prepareTilthSearchInput clamps broad expansion and large budgets", () => {
  assert.deepEqual(prepareTilthSearchInput({ query: "Auth", expand: 20, budget: 30000 }), {
    input: { query: "Auth", expand: 5, budget: 15000 },
    warnings: [
      "tilth_search budget clamped from 30000 to 15000; use section, scope, glob, or a narrower query instead of large budgets.",
      "tilth_search expand clamped from 20 to 5; read more matches only after the first result set is insufficient.",
    ],
  });
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
