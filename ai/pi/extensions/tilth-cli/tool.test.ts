import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDepsArgs,
  buildDiffArgs,
  buildGrokArgs,
  buildListArgs,
  buildReadArgs,
  buildSearchArgs,
  executeTilthCommand,
  executeTilthDiff,
  prepareTilthDiffInput,
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

test("buildReadArgs preserves an absolute scope for another checkout", () => {
  assert.deepEqual(buildReadArgs({ path: "src/auth.ts", scope: "/tmp/clone/repo" }, "/repo"), [
    "--scope",
    "/tmp/clone/repo",
    "--budget",
    "12000",
    "src/auth.ts",
  ]);
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

test("buildSearchArgs preserves an absolute scope for another checkout", () => {
  assert.deepEqual(buildSearchArgs({ query: "handleAuth", scope: "/tmp/clone/repo" }, "/repo"), [
    "--scope",
    "/tmp/clone/repo",
    "--budget",
    "10000",
    "--expand=2",
    "handleAuth",
  ]);
});

test("buildSearchArgs supports callers mode without losing default expansion", () => {
  assert.deepEqual(
    buildSearchArgs({ query: "handleAuth", mode: "callers", glob: "*.ts" }, "/repo"),
    ["--budget", "10000", "--glob", "*.ts", "--callers", "--expand=2", "handleAuth"],
  );
});

test("buildSearchArgs forwards multi-target caller queries", () => {
  assert.deepEqual(
    buildSearchArgs({ query: "handleAuth,authorize,loadUser", mode: "callers" }, "/repo"),
    ["--budget", "10000", "--callers", "--expand=2", "handleAuth,authorize,loadUser"],
  );
});

test("buildListArgs keeps the glob as the trailing query", () => {
  assert.deepEqual(buildListArgs({ pattern: "src/**/*.ts", budget: 200 }, "/repo"), [
    "--budget",
    "200",
    "src/**/*.ts",
  ]);
});

test("buildListArgs applies a small default budget", () => {
  assert.deepEqual(buildListArgs({ pattern: "src/**/*.ts" }, "/repo"), [
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

test("buildDiffArgs defaults to tracked changes relative to HEAD", () => {
  assert.deepEqual(buildDiffArgs({}, "/repo"), ["diff", "uncommitted", "--budget", "10000"]);
});

test("buildDiffArgs supports staged structural filtering", () => {
  assert.deepEqual(
    buildDiffArgs(
      {
        source: "staged",
        scope: "ai/pi",
        search: "launchPi",
        blast: true,
        expand: 3,
        budget: 9000,
      },
      "/repo",
    ),
    [
      "diff",
      "staged",
      "--scope",
      "ai/pi",
      "--search",
      "launchPi",
      "--blast",
      "--expand",
      "3",
      "--budget",
      "9000",
    ],
  );
});

test("executeTilthDiff runs in an explicit repository and keeps scope relative", async () => {
  let observedCwd: string | undefined;
  let observedArgs: string[] | undefined;
  await executeTilthDiff(
    async (_command, args, options) => {
      observedArgs = args;
      observedCwd = options?.cwd;
      return { code: 0, stdout: "", stderr: "", killed: false, truncated: false };
    },
    { repository: "/tmp/clone", scope: "src" },
    "/repo",
    undefined,
  );

  assert.equal(observedCwd, "/tmp/clone");
  assert.deepEqual(observedArgs, ["diff", "uncommitted", "--scope", "src", "--budget", "10000"]);
});

test("buildDiffArgs rejects an incomplete file pair", () => {
  assert.throws(() => buildDiffArgs({ a: "before.ts" }, "/repo"), /requires a and b together/);
});

test("buildDiffArgs rejects conflicting diff modes", () => {
  assert.throws(
    () => buildDiffArgs({ patch: "change.patch", log: "HEAD~2..HEAD" }, "/repo"),
    /mutually exclusive: patch, log/,
  );
  assert.throws(
    () => buildDiffArgs({ source: "HEAD~1", a: "before.ts", b: "after.ts" }, "/repo"),
    /mutually exclusive: source, file pair/,
  );
});

test("prepareTilthDiffInput enforces a positive budget", () => {
  assert.deepEqual(prepareTilthDiffInput({ budget: 0 }), {
    input: { budget: 1 },
    warnings: ["tilth_diff budget clamped from 0 to 1."],
  });
});

test("prepareTilthDiffInput clamps broad expansion and large budgets", () => {
  assert.deepEqual(prepareTilthDiffInput({ expand: 20, budget: 30000 }), {
    input: { expand: 5, budget: 15000 },
    warnings: [
      "tilth_diff budget clamped from 30000 to 15000; use section, scope, glob, or a narrower query instead of large budgets.",
      "tilth_diff expand clamped from 20 to 5; inspect the summary before expanding more changed symbols.",
    ],
  });
});

test("executeTilthCommand throws when Tilth exits unsuccessfully", async () => {
  await assert.rejects(
    executeTilthCommand(
      async () => ({
        code: 2,
        stdout: "",
        stderr: "invalid query",
        killed: false,
        truncated: false,
      }),
      ["query"],
      "/repo",
      undefined,
    ),
    /tilth command failed with exit code 2[\s\S]*invalid query/,
  );
});

test("executeTilthDiff rejects an invalid git ref before invoking Tilth", async () => {
  const commands: string[] = [];
  await assert.rejects(
    executeTilthDiff(
      async (command) => {
        commands.push(command);
        return {
          code: 128,
          stdout: "",
          stderr: "fatal: bad revision 'definitely-not-a-ref'",
          killed: false,
          truncated: false,
        };
      },
      { source: "definitely-not-a-ref" },
      "/repo",
      undefined,
    ),
    /source 'definitely-not-a-ref' is invalid[\s\S]*fatal: bad revision/,
  );
  assert.deepEqual(commands, ["git"]);
});
