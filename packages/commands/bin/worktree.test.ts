import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Logger, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";

import {
  buildWorktreeListRows,
  command,
  evaluateCreateCollision,
  formatDisplayPath,
  formatExistingLocalBranchConflict,
  getBranchDeletionFlag,
  getComparisonRef,
  getInvocationDirectory,
  getWorktreePathKind,
  hasChanges,
  isConfirmedAnswer,
  isExplicitRemoteBranchRequest,
  isReusableExistingWorktree,
  parsePullRequestMetadataJson,
  resolveCreateWorktreePath,
  resolvePrHeadSource,
  resolveRemoteBranchFromRefs,
  resolveRemovalTarget,
  resolveRepoSearchStart,
  sanitizePathToken,
  toYesNo,
} from "./worktree.ts";

function fixture(t: TestContext): {
  root: string;
  repo: string;
  env: NodeJS.ProcessEnv;
  git: (...args: string[]) => string;
  run: (...args: string[]) => SpawnSyncReturns<string>;
} {
  const root = mkdtempSync(join(tmpdir(), "mb-worktree-test-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const repo = join(root, "repo");
  const git = (...args: string[]): string => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git("init", "-b", "main", repo);
  git("-C", repo, "config", "user.name", "Test");
  git("-C", repo, "config", "user.email", "test@example.invalid");
  git("-C", repo, "commit", "--allow-empty", "-m", "initial");
  git("-C", repo, "remote", "add", "origin", "https://github.com/example/repo.git");
  git("-C", repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git("clone", "--bare", repo, join(root, "remote.git"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  // All command traffic stays local, including fetch, GitHub metadata, and journald.
  writeFileSync(
    join(bin, "git"),
    `#!${process.execPath}
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "fetch") {
  if (process.env.FIXTURE_FETCH_FAIL) {
    console.error("fixture fetch failed");
    process.exit(37);
  }
  if (process.env.FIXTURE_FETCH_WAIT) {
    appendFileSync(process.env.FIXTURE_FETCH_WAIT, String(process.pid));
    process.on("SIGTERM", () => process.exit(0));
    console.error("fixture fetch waiting");
    await new Promise(() => { setInterval(() => {}, 1000); });
  }
  const branch = args[2];
  args.splice(1, 2, process.env.FIXTURE_REMOTE, branch + ":refs/remotes/origin/" + branch);
}
const result = spawnSync("git", args, {
  stdio: "inherit",
  env: { ...process.env, PATH: process.env.FIXTURE_PATH },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "logger"),
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
appendFileSync(process.env.FIXTURE_JOURNAL, input + "\\n");
if (process.env.FIXTURE_FETCH_WAIT && input.includes("MB_EVENT=subprocess_stderr")) {
  console.error("fixture log ready");
}
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
import { readFileSync } from "node:fs";
process.stdout.write(readFileSync(process.env.FIXTURE_METADATA, "utf8"));
`,
    { mode: 0o755 },
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AI_CWD: repo,
    PATH: `${bin}:${process.env["PATH"]}`,
    FIXTURE_PATH: process.env["PATH"],
    FIXTURE_REMOTE: join(root, "remote.git"),
    FIXTURE_CALLS: join(root, "calls"),
    FIXTURE_JOURNAL: join(root, "journal"),
    FIXTURE_METADATA: join(root, "metadata.json"),
  };
  const run = (...args: string[]): SpawnSyncReturns<string> =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./worktree.ts", import.meta.url)), ...args],
      {
        cwd: repo,
        env,
        encoding: "utf8",
        timeout: 20_000,
      },
    );
  return { root, repo, env, git, run };
}

test("executable preserves worktree creation and removal safety", (t) => {
  const { root, repo, git, run } = fixture(t);
  const target = join(root, "repo-feature");
  const dry = run("new-branch", "feature", "--from", "main", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run/u);
  assert.doesNotMatch(git("-C", repo, "branch", "--list"), /feature/u);

  const created = run("new-branch", "feature", "--from", "main", "--no-setup");
  assert.equal(created.status, 0, created.stderr);
  const list = run("list", "--json");
  assert.equal(list.status, 0, list.stderr);
  const rows = JSON.parse(list.stdout) as { branch: string; path: string }[];
  assert.ok(rows.some((row) => row.branch === "feature" && row.path === target));

  const primary = run("remove", "main", "--force");
  assert.notEqual(primary.status, 0);
  assert.match(primary.stderr, /Refusing to remove/u);
  writeFileSync(join(target, "untracked"), "data");
  const noninteractive = run("remove", "feature", "--delete-branch");
  assert.notEqual(noninteractive.status, 0);
  assert.match(noninteractive.stderr, /no interactive terminal/u);
  assert.match(git("-C", repo, "branch", "--list"), /feature/u);
  const removed = run("remove", "feature", "--delete-branch", "--force");
  assert.equal(removed.status, 0, removed.stderr);
  assert.doesNotMatch(git("-C", repo, "branch", "--list"), /feature/u);
});

test("CLI preserves shared option placement, path resolution, and the option separator", (t) => {
  const { repo, run } = fixture(t);
  const created = run(
    "--repo",
    "../repo",
    "--no-setup",
    "new-branch",
    "feature/test",
    "--from",
    "main",
    "--path",
    "custom/worktree",
  );
  assert.equal(created.status, 0, created.stderr);
  assert.ok(existsSync(join(repo, "custom/worktree/.git")));
  const dry = run("--force", "remove", "feature/test", "--dry-run", "--delete-branch");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Delete branch: feature\/test/u);
  assert.ok(existsSync(join(repo, "custom/worktree/.git")));
  const literal = run("checkout", "--", "--not-an-option");
  assert.notEqual(literal.status, 0);
  assert.match(literal.stderr, /Could not resolve ref: --not-an-option/u);
});

test("CLI validates options and arguments and provides help without repository discovery", (t) => {
  const { env, root, run } = fixture(t);
  env["AI_CWD"] = root;
  for (const args of [["--help"], ["checkout", "--help"], ["-h"]]) {
    const help = run(...args);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /USAGE/u);
    assert.doesNotMatch(help.stderr, /not a git repository/u);
  }
  for (const args of [
    [],
    ["unknown"],
    ["checkout"],
    ["list", "extra"],
    ["list", "--unknown"],
    ["list", "--repo="],
    ["checkout", "main", "--path="],
    ["new-from-main", ""],
    ["new-from-pr", ""],
  ]) {
    const result = run(...args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
});

test("creation reuses matching worktrees and refuses branch and path collisions", (t) => {
  const { root, repo, git, run } = fixture(t);
  const created = run("new-branch", "feature", "--from", "main", "--no-setup");
  assert.equal(created.status, 0, created.stderr);
  const reused = run("checkout", "feature", "--no-setup");
  assert.equal(reused.status, 0, reused.stderr);
  assert.match(reused.stdout, /already exists/u);
  const branchConflict = run("checkout", "feature", "--path", "elsewhere");
  assert.notEqual(branchConflict.status, 0);
  assert.match(branchConflict.stderr, /already checked out/u);
  const pathConflict = run(
    "new-branch",
    "other",
    "--from",
    "main",
    "--path",
    join(root, "repo-feature"),
  );
  assert.notEqual(pathConflict.status, 0);
  assert.match(pathConflict.stderr, /different worktree/u);
  mkdirSync(join(root, "repo-occupied"));
  const occupied = run("new-branch", "occupied", "--from", "main");
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, /not a registered worktree/u);
  assert.doesNotMatch(git("-C", repo, "branch", "--list"), /other|occupied/u);
});

test("detached worktrees are reused by commit and always require removal confirmation", (t) => {
  const { root, repo, git, run } = fixture(t);
  git("-C", repo, "tag", "release");
  const created = run("checkout", "release", "--no-setup");
  assert.equal(created.status, 0, created.stderr);
  const reused = run("checkout", "release");
  assert.equal(reused.status, 0, reused.stderr);
  assert.match(reused.stdout, /already exists/u);
  const target = join(root, "repo-detached-release");
  const remove = run("remove", target);
  assert.notEqual(remove.status, 0);
  assert.match(remove.stderr, /no interactive terminal/u);
  const list = run("list", "--json");
  assert.equal(list.status, 0, list.stderr);
  assert.ok(
    (JSON.parse(list.stdout) as { source: string; localCommits: string }[]).some(
      (row) => row.source === "detached" && row.localCommits === "n/a",
    ),
  );
});

test("setup failures retain created worktrees; skipped setup and dry runs never execute the hook", (t) => {
  const { root, repo, git, run } = fixture(t);
  writeFileSync(join(repo, "setup-worktree.sh"), 'printf "hook failed\\n" >&2\nexit 23\n');
  const failed = run("new-branch", "hook-fails", "--from", "main");
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /hook failed/u);
  assert.ok(existsSync(join(root, "repo-hook-fails/.git")));
  assert.match(git("-C", repo, "branch", "--list"), /hook-fails/u);
  const skipped = run("new-branch", "skip", "--from", "main", "--no-setup");
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /Skipped setup-worktree.sh/u);
  const dry = run("new-branch", "dry", "--from", "main", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(!existsSync(join(root, "repo-dry")));
  assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"add","-b","dry"/u);
  const journal = readFileSync(join(root, "journal"), "utf8");
  assert.match(journal, /MB_EVENT=worktree_created/u);
  assert.match(journal, /MB_EXIT_CODE=23/u);
  assert.match(journal, /MB_STDERR=hook failed/u);
  assert.match(journal, /MB_OUTCOME=failure/u);
  assert.match(journal, /MB_RUN_ID=/u);
});

test("failed worktree removal never deletes the branch and protects primary and current checkouts", (t) => {
  const { root, repo, env, git, run } = fixture(t);
  const created = run("new-branch", "locked", "--from", "main", "--no-setup");
  assert.equal(created.status, 0, created.stderr);
  const target = join(root, "repo-locked");
  git("-C", repo, "worktree", "lock", target);
  const failed = run("remove", "locked", "--delete-branch", "--force");
  assert.notEqual(failed.status, 0);
  assert.ok(existsSync(join(target, ".git")));
  assert.match(git("-C", repo, "branch", "--list"), /locked/u);
  assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"branch","-D","locked"/u);
  env["AI_CWD"] = target;
  const primary = run("remove", "main", "--force");
  assert.notEqual(primary.status, 0);
  assert.match(primary.stderr, /primary repository checkout/u);
  const current = run("remove", "locked", "--force");
  assert.notEqual(current.status, 0);
  assert.match(current.stderr, /current worktree/u);
});

test("fetch workflows stay read-only in dry runs and stop before creation when fetch fails", (t) => {
  const { root, env, run } = fixture(t);
  const dry = run("new-from-main", "dry", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"fetch"/u);
  env["FIXTURE_FETCH_FAIL"] = "1";
  const failed = run("new-from-main", "failed", "--no-setup");
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /fixture fetch failed/u);
  assert.ok(!existsSync(join(root, "repo-failed")));
  assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"worktree","add"/u);
  delete env["FIXTURE_FETCH_FAIL"];
  const created = run("new-from-main", "success", "--no-setup");
  assert.equal(created.status, 0, created.stderr);
  assert.ok(existsSync(join(root, "repo-success/.git")));
});

test("PR creation validates same-repo metadata before fetch and preserves local-branch conflicts", (t) => {
  const { root, repo, git, run } = fixture(t);
  const metadata = {
    number: 42,
    headRefName: "pr-feature",
    isCrossRepository: true,
    headRepository: { name: "repo", nameWithOwner: "example/repo" },
  };
  const save = (): void => {
    writeFileSync(join(root, "metadata.json"), JSON.stringify(metadata));
  };
  save();
  const fork = run("new-from-pr", "42");
  assert.notEqual(fork.status, 0);
  assert.match(fork.stderr, /fork\/cross-repo/u);
  metadata.isCrossRepository = false;
  metadata.headRepository.nameWithOwner = "someone/else";
  save();
  const mismatch = run("new-from-pr", "42");
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /does not match/u);
  assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"fetch"/u);
  metadata.headRepository.nameWithOwner = "example/repo";
  save();
  git(
    "--git-dir",
    join(root, "remote.git"),
    "update-ref",
    "refs/heads/pr-feature",
    "refs/heads/main",
  );
  git("-C", repo, "update-ref", "refs/remotes/origin/pr-feature", "HEAD");
  const dry = run("new-from-pr", "42", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"fetch"/u);
  const created = run("new-from-pr", "42", "--no-setup");
  assert.equal(created.status, 0, created.stderr);
  assert.ok(existsSync(join(root, "repo-pr-feature/.git")));
  const conflict = run("new-from-pr", "42", "--dry-run");
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /Local branch "pr-feature" already exists/u);
});

test("interactive removal requires explicit yes and interruption never proceeds with deletion", async (t) => {
  const { root, repo, git } = fixture(t);
  const target = join(root, "repo-dirty");
  git("-C", repo, "worktree", "add", "-b", "dirty", target, "main");
  writeFileSync(join(target, "untracked"), "private data");
  const questions: string[] = [];
  const run = (
    answer: Effect.Effect<string, Terminal.QuitError>,
  ): Promise<Exit.Exit<void, unknown>> =>
    Effect.runPromiseExit(
      Command.runWith(command, { version: "0.0.0", renderErrors: false })([
        "--repo",
        repo,
        "remove",
        "dirty",
        "--delete-branch",
      ]).pipe(
        Effect.provideService(
          Terminal.Terminal,
          Terminal.make({
            columns: Effect.succeed(80),
            rows: Effect.succeed(24),
            size: Effect.die("unused"),
            readInput: Effect.die("unused"),
            readLine: answer,
            display: (question) =>
              Effect.sync(() => {
                questions.push(question);
              }),
          }),
        ),
        Effect.provide(
          Stdio.layerTest({
            stdinIsTerminal: Effect.succeed(true),
            stdoutIsTerminal: Effect.succeed(true),
          }),
        ),
        Effect.provide(Logger.layer([])),
        Effect.provide(NodeServices.layer),
      ),
    );
  const declined = await run(Effect.succeed("no"));
  assert.ok(Exit.isSuccess(declined));
  assert.match(questions[0] ?? "", /untracked files/u);
  assert.ok(existsSync(join(target, "untracked")));
  const interrupted = await run(Effect.interrupt);
  assert.ok(Exit.isFailure(interrupted) && Exit.hasInterrupts(interrupted));
  assert.ok(existsSync(join(target, ".git")));
  assert.match(git("-C", repo, "branch", "--list"), /dirty/u);
  const confirmed = await run(Effect.succeed("yes"));
  assert.ok(
    Exit.isSuccess(confirmed),
    Exit.isFailure(confirmed) ? Cause.pretty(confirmed.cause) : "",
  );
  assert.ok(!existsSync(target));
  assert.doesNotMatch(git("-C", repo, "branch", "--list"), /dirty/u);
});

test(
  "interrupting an active subprocess terminates it and flushes cancellation diagnostics",
  { timeout: 20_000 },
  async (t) => {
    const { root, repo, env } = fixture(t);
    const pidPath = join(root, "fetch.pid");
    env["FIXTURE_FETCH_WAIT"] = pidPath;
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./worktree.ts", import.meta.url)),
        "new-from-main",
        "cancelled",
        "--no-setup",
      ],
      { cwd: repo, env },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (existsSync(pidPath)) {
        try {
          process.kill(Number(readFileSync(pidPath, "utf8")), "SIGKILL");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
      }
    });
    let stderr = "";
    const completed = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        // Wait for journald's receipt, not a timer, so the diagnostic is guaranteed retained.
        if (stderr.includes("fixture log ready")) child.kill("SIGTERM");
      });
      child.once("close", (code) => {
        resolve(code);
      });
    });
    child.stdout.resume();
    const code = await completed;
    assert.notEqual(code, 0);
    assert.match(stderr, /fixture fetch waiting/u);
    assert.match(stderr, /fixture log ready/u);
    const pid = Number(readFileSync(pidPath, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const journal = readFileSync(join(root, "journal"), "utf8");
    assert.match(journal, /MB_STDERR=fixture fetch waiting/u);
    assert.match(journal, /MB_EVENT=subprocess_finished/u);
    assert.match(journal, /MB_EVENT=run_finished/u);
    assert.match(journal, /MB_OUTCOME=cancelled/u);
    assert.ok(!existsSync(join(root, "repo-cancelled")));
    assert.doesNotMatch(readFileSync(join(root, "calls"), "utf8"), /"worktree","add"/u);
  },
);

test("invalid external data and unresolved targets retain useful CLI errors", (t) => {
  const { root, repo, git, run } = fixture(t);
  writeFileSync(join(root, "metadata.json"), '{"number": "wrong"}');
  const metadata = run("new-from-pr", "42", "--dry-run");
  assert.notEqual(metadata.status, 0);
  assert.match(metadata.stderr, /gh PR metadata: invalid JSON/u);
  const missing = run("remove", "missing");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Could not find worktree by branch or path: missing/u);
  git("-C", repo, "remote", "set-url", "origin", "/not-a-github-url");
  const origin = run("list");
  assert.notEqual(origin.status, 0);
  assert.match(origin.stderr, /Unsupported GitHub origin URL/u);
});

test("repo targeting uses AI_CWD by default and resolves relative --repo from it", () => {
  assert.deepEqual(getInvocationDirectory("/accel-os/scripts", "/work/project"), "/work/project");
  assert.deepEqual(getInvocationDirectory("/work/project", null), "/work/project");
  assert.deepEqual(resolveRepoSearchStart("/work/project", null), "/work/project");
  assert.deepEqual(resolveRepoSearchStart("/work/project", "../other"), "/work/other");
  assert.deepEqual(resolveRepoSearchStart("/work/project", "/tmp/repo"), "/tmp/repo");
});

test("resolveRemoteBranchFromRefs accepts slash-named remote branches by branch name", () => {
  const remoteRefs = [
    "origin/main",
    "origin/change-rank",
    "origin/1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
    "upstream/change-rank",
  ];

  assert.deepEqual(
    resolveRemoteBranchFromRefs(
      remoteRefs,
      "1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
    ),
    {
      remoteRef: "origin/1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
      localBranchName: "1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
    },
  );
});

test("resolveRemoteBranchFromRefs rejects ambiguous branch names across remotes", () => {
  const remoteRefs = ["origin/change-rank", "upstream/change-rank"];
  assert.throws(
    () => resolveRemoteBranchFromRefs(remoteRefs, "change-rank"),
    /matches multiple remote branches/u,
  );
});

test("resolveRemoteBranchFromRefs preserves explicit remote refs", () => {
  assert.deepEqual(resolveRemoteBranchFromRefs(["origin/change-rank"], "origin/change-rank"), {
    remoteRef: "origin/change-rank",
    localBranchName: "change-rank",
  });
});

test("explicit remote checkout requests are remote-first", () => {
  assert.deepEqual(
    isExplicitRemoteBranchRequest("origin/change-rank", {
      remoteRef: "origin/change-rank",
    }),
    true,
  );
  assert.deepEqual(
    isExplicitRemoteBranchRequest("change-rank", {
      remoteRef: "origin/change-rank",
    }),
    false,
  );
});

test("resolveRemoteBranchFromRefs returns null when no remote branch matches", () => {
  assert.deepEqual(resolveRemoteBranchFromRefs(["origin/main"], "missing-branch"), null);
});

test("path planning uses sibling defaults and respects overrides", () => {
  assert.deepEqual(
    resolveCreateWorktreePath("/parent/PAB", "../PAB-demo", null),
    "/parent/PAB-demo",
  );
  assert.deepEqual(
    resolveCreateWorktreePath("/repo", "../repo-demo", "tmp/demo"),
    "/repo/tmp/demo",
  );
  assert.deepEqual(
    resolveCreateWorktreePath("/repo", "../repo-demo", "/tmp/custom-demo"),
    "/tmp/custom-demo",
  );
});

test("sanitizePathToken stays predictable", () => {
  assert.deepEqual(sanitizePathToken("feature/foo bar"), "feature-foo-bar");
  assert.deepEqual(sanitizePathToken("🔥/💥"), "ref");
});

test("PR and detached helpers preserve source semantics", () => {
  assert.deepEqual(resolvePrHeadSource("change-rank"), "origin/change-rank");
  assert.ok(
    formatExistingLocalBranchConflict("change-rank", "remote ref origin/change-rank").includes(
      'Local branch "change-rank" already exists',
    ),
  );
  assert.ok(
    formatExistingLocalBranchConflict("change-rank", "fetched PR head origin/change-rank").includes(
      "refusing to create or reuse it",
    ),
  );
  assert.deepEqual(
    getComparisonRef({ path: "/parent/repo-detached-abc", detached: true }, null),
    "HEAD",
  );
  assert.deepEqual(
    getComparisonRef({ path: "/parent/repo-release-fix", detached: false }, null),
    "origin/main",
  );
});

test("PR metadata parsing tolerates extra GitHub object fields", () => {
  assert.deepEqual(
    parsePullRequestMetadataJson(
      JSON.stringify({
        number: 42,
        headRefName: "feature/pr-head",
        isCrossRepository: false,
        headRepository: {
          id: "R_123",
          name: "repo",
          nameWithOwner: "owner/repo",
          owner: {
            id: "U_123",
            login: "owner",
          },
        },
        headRepositoryOwner: {
          id: "U_123",
          login: "owner",
        },
      }),
      "fallback-owner",
    ),
    {
      number: 42,
      headRefName: "feature/pr-head",
      isCrossRepository: false,
      headRepository: {
        name: "repo",
        nameWithOwner: "owner/repo",
        ownerLogin: "owner",
      },
    },
  );
});

test("PR metadata parsing reports malformed or invalid GitHub responses", () => {
  assert.throws(
    () => parsePullRequestMetadataJson("{", "owner"),
    /gh PR metadata: invalid JSON syntax/u,
  );
  assert.throws(
    () => parsePullRequestMetadataJson('{"number":"42"}', "owner"),
    /gh PR metadata: invalid JSON/u,
  );
});

test("removal helpers resolve targets and changed-state rules", () => {
  const branchStatus = {
    worktree: {
      path: "/parent/repo-change-rank",
      head: "abc",
      branchRef: "refs/heads/change-rank",
      branchName: "change-rank",
      detached: false,
    },
    isCurrent: false,
    isPrimary: false,
    dirty: false,
    untracked: false,
    localCommits: 0,
    upstreamRef: null,
    comparisonRef: "origin/change-rank",
  };

  const detachedStatus = {
    worktree: {
      path: "/parent/repo-detached-abc",
      head: "abc",
      branchRef: null,
      branchName: null,
      detached: true,
    },
    isCurrent: false,
    isPrimary: false,
    dirty: true,
    untracked: false,
    localCommits: 0,
    upstreamRef: null,
    comparisonRef: "HEAD",
  };

  assert.deepEqual(
    resolveRemovalTarget([branchStatus, detachedStatus], "/repo", "change-rank"),
    branchStatus,
  );
  assert.deepEqual(
    resolveRemovalTarget([branchStatus, detachedStatus], "/repo", "/parent/repo-detached-abc"),
    detachedStatus,
  );
  assert.deepEqual(hasChanges(branchStatus), false);
  assert.deepEqual(hasChanges({ ...detachedStatus, dirty: false }), true);
  assert.deepEqual(hasChanges({ ...branchStatus, untracked: true }), true);
  assert.deepEqual(hasChanges({ ...branchStatus, localCommits: 2 }), true);
  assert.deepEqual(getBranchDeletionFlag({ ...branchStatus, localCommits: 0 }, false), "-d");
  assert.deepEqual(getBranchDeletionFlag({ ...branchStatus, localCommits: 2 }, false), "-D");
  assert.deepEqual(getBranchDeletionFlag({ ...branchStatus, localCommits: 0 }, true), "-D");
});

test("confirmation answers require explicit yes", () => {
  assert.deepEqual(isConfirmedAnswer("y"), true);
  assert.deepEqual(isConfirmedAnswer("YES\n"), true);
  assert.deepEqual(isConfirmedAnswer(""), false);
  assert.deepEqual(isConfirmedAnswer("n"), false);
});

test("reusable worktree detection works for branch and detached targets", () => {
  const branchWorktree = {
    path: "/parent/repo-change-rank",
    head: "abc",
    branchRef: "refs/heads/change-rank",
    branchName: "change-rank",
    detached: false,
  };
  const detachedWorktree = {
    path: "/parent/repo-detached-abc",
    head: "abc",
    branchRef: null,
    branchName: null,
    detached: true,
  };

  assert.deepEqual(
    isReusableExistingWorktree(branchWorktree, {
      kind: "branch",
      worktreePath: "/parent/repo-change-rank",
      branchName: "change-rank",
      createArgs: [],
      displaySource: "change-rank",
    }),
    true,
  );
  assert.deepEqual(
    isReusableExistingWorktree(detachedWorktree, {
      kind: "detached",
      worktreePath: "/parent/repo-detached-abc",
      resolvedCommit: "abc",
      requestedRef: "abc",
      createArgs: [],
      displaySource: "abc",
    }),
    true,
  );
});

test("display helpers stay predictable", () => {
  const branchWorktree = {
    path: "/parent/repo-change-rank",
    head: "abc",
    branchRef: "refs/heads/change-rank",
    branchName: "change-rank",
    detached: false,
  };

  assert.deepEqual(
    formatDisplayPath("/repo", "/parent/repo-change-rank"),
    "/parent/repo-change-rank",
  );
  assert.deepEqual(formatDisplayPath("/repo", "/tmp/external"), "/tmp/external");
  assert.deepEqual(getWorktreePathKind("/repo", branchWorktree), "custom");
  assert.deepEqual(
    getWorktreePathKind("/repo", {
      ...branchWorktree,
      path: "/repo/.tmp-worktrees/change-rank",
    }),
    "custom",
  );
  assert.deepEqual(
    getWorktreePathKind("/parent/repo", {
      ...branchWorktree,
      path: "/parent/repo-change-rank",
    }),
    "default",
  );
  assert.deepEqual(toYesNo(true), "yes");
  assert.deepEqual(toYesNo(false), "no");
});

test("buildWorktreeListRows produces rich rows", () => {
  const branchStatus = {
    worktree: {
      path: "/parent/repo-change-rank",
      head: "abc",
      branchRef: "refs/heads/change-rank",
      branchName: "change-rank",
      detached: false,
    },
    isCurrent: false,
    isPrimary: false,
    dirty: false,
    untracked: false,
    localCommits: 0,
    upstreamRef: null,
    comparisonRef: "origin/change-rank",
  };

  const detachedStatus = {
    worktree: {
      path: "/parent/repo-detached-abc",
      head: "abc",
      branchRef: null,
      branchName: null,
      detached: true,
    },
    isCurrent: false,
    isPrimary: false,
    dirty: true,
    untracked: false,
    localCommits: 0,
    upstreamRef: null,
    comparisonRef: "HEAD",
  };

  assert.deepEqual(buildWorktreeListRows("/repo", [branchStatus, detachedStatus]), [
    {
      branch: "change-rank",
      source: "branch",
      pathKind: "custom",
      upstream: "(none)",
      comparison: "origin/change-rank",
      path: "/parent/repo-change-rank",
      dirty: "no",
      untracked: "no",
      localCommits: "0",
      current: "no",
      primary: "no",
    },
    {
      branch: "(detached)",
      source: "detached",
      pathKind: "custom",
      upstream: "(none)",
      comparison: "HEAD",
      path: "/parent/repo-detached-abc",
      dirty: "yes",
      untracked: "no",
      localCommits: "n/a",
      current: "no",
      primary: "no",
    },
  ]);
});

test("creation collision helpers distinguish reuse, path conflicts, branch conflicts, and create-new", () => {
  const existingBranchWorktree = {
    path: "/parent/repo-change-rank",
    head: "abc",
    branchRef: "refs/heads/change-rank",
    branchName: "change-rank",
    detached: false,
  };
  const otherBranchWorktree = {
    path: "/parent/repo-other-branch",
    head: "def",
    branchRef: "refs/heads/other-branch",
    branchName: "other-branch",
    detached: false,
  };
  const detachedWorktree = {
    path: "/parent/repo-detached-abc",
    head: "abc",
    branchRef: null,
    branchName: null,
    detached: true,
  };

  assert.deepEqual(
    evaluateCreateCollision([existingBranchWorktree], {
      kind: "branch",
      worktreePath: "/parent/repo-change-rank",
      branchName: "change-rank",
      createArgs: [],
      displaySource: "change-rank",
    }),
    {
      kind: "reuse-existing",
      existingWorktree: existingBranchWorktree,
    },
  );
  assert.deepEqual(
    evaluateCreateCollision([otherBranchWorktree], {
      kind: "branch",
      worktreePath: "/parent/repo-other-branch",
      branchName: "change-rank",
      createArgs: [],
      displaySource: "change-rank",
    }),
    {
      kind: "path-conflict",
      existingWorktree: otherBranchWorktree,
    },
  );
  assert.deepEqual(
    evaluateCreateCollision([existingBranchWorktree], {
      kind: "branch",
      worktreePath: "/parent/custom-change-rank",
      branchName: "change-rank",
      createArgs: [],
      displaySource: "change-rank",
    }),
    {
      kind: "branch-conflict",
      existingWorktree: existingBranchWorktree,
    },
  );
  assert.deepEqual(
    evaluateCreateCollision([detachedWorktree], {
      kind: "detached",
      worktreePath: "/parent/repo-detached-abc",
      resolvedCommit: "abc",
      requestedRef: "abc",
      createArgs: [],
      displaySource: "abc",
    }),
    {
      kind: "reuse-existing",
      existingWorktree: detachedWorktree,
    },
  );
  assert.deepEqual(
    evaluateCreateCollision([existingBranchWorktree], {
      kind: "branch",
      worktreePath: "/parent/repo-new-branch",
      branchName: "new-branch",
      createArgs: [],
      displaySource: "HEAD",
    }),
    {
      kind: "create-new",
    },
  );
});
