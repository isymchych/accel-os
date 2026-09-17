import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAssessCommand,
  buildCalleesCommand,
  buildCallersCommand,
  buildCompareCommand,
  buildContextCommand,
  buildDepsCommand,
  buildDiscoverCommand,
  buildOverviewCommand,
  buildReadCommand,
  buildReviewCommand,
  executeSrcwalkCommand,
} from "./tool.ts";

test("buildReadCommand uses the show subcommand and resolves scope", () => {
  assert.deepEqual(
    buildReadCommand(
      {
        target: "@src/auth.ts:40",
        scope: "packages/app",
        section: "authorize",
        context_lines: 8,
        full: true,
        artifact: true,
        budget: 500,
      },
      "/repo",
    ),
    {
      args: [
        "show",
        "src/auth.ts:40",
        "--scope",
        "/repo/packages/app",
        "--artifact",
        "--budget",
        "500",
        "--section",
        "authorize",
        "--context-lines",
        "8",
        "--full",
      ],
      warnings: [],
    },
  );
});

test("buildDiscoverCommand supports repeated symbol scopes and clamps expansion", () => {
  assert.deepEqual(
    buildDiscoverCommand(
      {
        query: "authorize,loadUser",
        kind: "symbol",
        scopes: ["src", "/tmp/other/repo"],
        expand: 20,
        limit: 12,
        offset: 4,
      },
      "/repo",
    ),
    {
      args: [
        "discover",
        "authorize,loadUser",
        "--scope",
        "/repo/src",
        "--scope",
        "/tmp/other/repo",
        "--budget",
        "6000",
        "--as",
        "symbol",
        "--expand=5",
        "--limit",
        "12",
        "--offset",
        "4",
      ],
      warnings: ["srcwalk_discover expand clamped from 20 to 5."],
    },
  );
});

test("buildDiscoverCommand rejects multiple non-symbol scopes", () => {
  assert.throws(
    () => buildDiscoverCommand({ query: "TODO", kind: "text", scopes: ["src", "tests"] }, "/repo"),
    /multiple scopes only when kind is 'symbol'/,
  );
});

test("context, assess, and compare commands use common bounded options", () => {
  assert.deepEqual(buildContextCommand({ target: "Auth", depth: 9 }, "/repo"), {
    args: ["context", "Auth", "--budget", "6000", "--depth", "5"],
    warnings: ["srcwalk_context depth clamped from 9 to 5."],
  });
  assert.deepEqual(buildAssessCommand({ target: "Auth", budget: 30_000 }, "/repo"), {
    args: ["assess", "Auth", "--budget", "15000"],
    warnings: ["srcwalk budget clamped from 30000 to 15000."],
  });
  assert.deepEqual(buildCompareCommand({ target_a: "old", target_b: "new" }, "/repo"), {
    args: ["compare", "old", "new", "--budget", "6000"],
    warnings: [],
  });
});

test("callers validates direct-only filters and builds transitive controls", () => {
  assert.throws(
    () => buildCallersCommand({ target: "Auth", depth: 2, filter: "file:auth" }, "/repo"),
    /apply only to direct callers/,
  );
  assert.deepEqual(
    buildCallersCommand(
      { target: "Auth", depth: 3, max_frontier: 8, max_edges: 40, skip_hubs: "main,run" },
      "/repo",
    ),
    {
      args: [
        "trace",
        "callers",
        "Auth",
        "--budget",
        "6000",
        "--depth",
        "3",
        "--max-frontier",
        "8",
        "--max-edges",
        "40",
        "--skip-hubs",
        "main,run",
      ],
      warnings: [],
    },
  );
});

test("callees requires detailed mode for filters", () => {
  assert.throws(
    () => buildCalleesCommand({ target: "Auth", filter: "file:auth" }, "/repo"),
    /requires detailed=true/,
  );
  assert.deepEqual(
    buildCalleesCommand({ target: "Auth", detailed: true, filter: "file:auth" }, "/repo"),
    {
      args: ["trace", "callees", "Auth", "--budget", "6000", "--detailed", "--filter", "file:auth"],
      warnings: [],
    },
  );
});

test("deps and overview preserve their distinct budget contracts", () => {
  assert.deepEqual(buildDepsCommand({ path: "@src/auth.ts", limit: 10 }, "/repo"), {
    args: ["deps", "src/auth.ts", "--budget", "6000", "--limit", "10"],
    warnings: [],
  });
  assert.deepEqual(buildOverviewCommand({ scope: "/tmp/clone", symbols: true }, "/repo"), {
    args: ["overview", "--scope", "/tmp/clone", "--symbols"],
    warnings: [],
  });
});

test("review executes in an explicit repository and keeps scope relative to it", () => {
  assert.deepEqual(
    buildReviewCommand({ repository: "/tmp/clone", scope: "src", staged: true, limit: 5 }, "/repo"),
    {
      args: ["review", "--scope", "/tmp/clone/src", "--budget", "6000", "--staged", "--limit", "5"],
      warnings: [],
      cwd: "/tmp/clone",
    },
  );
});

test("review rejects staged plus an explicit target", () => {
  assert.throws(
    () => buildReviewCommand({ staged: true, target: "HEAD~1..HEAD" }, "/repo"),
    /cannot be combined/,
  );
});

test("executeSrcwalkCommand forwards cwd and reports warnings", async () => {
  let observedCwd: string | undefined;
  const result = await executeSrcwalkCommand(
    async (_command, args, options) => {
      assert.deepEqual(args, ["overview"]);
      observedCwd = options?.cwd;
      return { code: 0, stdout: "one\ntwo\n", stderr: "", killed: false };
    },
    { args: ["overview"], warnings: ["clamped"] },
    "/repo",
    undefined,
  );
  assert.equal(observedCwd, "/repo");
  assert.match(result.content[0].text, /^one\ntwo/);
  assert.match(result.content[0].text, /Srcwalk argument note: clamped/);
});

test("executeSrcwalkCommand throws with stderr on unsuccessful exit", async () => {
  await assert.rejects(
    executeSrcwalkCommand(
      async () => ({
        code: 2,
        stdout: "",
        stderr: "invalid target",
        killed: false,
      }),
      { args: ["show", "missing"], warnings: [] },
      "/repo",
      undefined,
    ),
    /failed with exit code 2[\s\S]*invalid target/,
  );
});
