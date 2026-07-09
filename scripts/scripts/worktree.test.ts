import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorktreeListRows,
  evaluateCreateCollision,
  formatDisplayPath,
  formatExistingLocalBranchConflict,
  getBranchDeletionFlag,
  getComparisonRef,
  getInvocationDirectory,
  getWorktreePathKind,
  hasChanges,
  isExplicitRemoteBranchRequest,
  isReusableExistingWorktree,
  parseArgs,
  resolveCreateWorktreePath,
  resolvePrHeadSource,
  resolveRemoteBranchFromRefs,
  resolveRemovalTarget,
  resolveRepoSearchStart,
  sanitizePathToken,
  toYesNo,
} from "./worktree.ts";

test("parseArgs parses create flags including dry-run, repo, and path override", () => {
  const parsed = parseArgs([
    "--repo",
    "../target-repo",
    "new-branch",
    "feature/test",
    "--from",
    "origin/main",
    "--path",
    "custom/worktree",
    "--dry-run",
    "--no-setup",
  ]);

  assert.deepEqual(parsed.command, "new-branch");
  assert.deepEqual(parsed.positional, ["feature/test"]);
  assert.deepEqual(parsed.fromRef, "origin/main");
  assert.deepEqual(parsed.pathOverride, "custom/worktree");
  assert.deepEqual(parsed.repoOverride, "../target-repo");
  assert.deepEqual(parsed.dryRun, true);
  assert.deepEqual(parsed.runSetup, false);
});

test("parseArgs rejects empty path overrides", () => {
  assert.throws(() => parseArgs(["checkout", "main", "--path="]), {
    message: 'Option "--path" requires a directory value.',
  });
});

test("parseArgs rejects empty repo overrides", () => {
  assert.throws(() => parseArgs(["list", "--repo="]), {
    message: 'Option "--repo" requires a directory value.',
  });
});

test("parseArgs parses remove dry-run flags", () => {
  const parsed = parseArgs(["remove", "../PAB-demo", "--force", "--dry-run"]);
  assert.deepEqual(parsed.command, "remove");
  assert.deepEqual(parsed.positional, ["../PAB-demo"]);
  assert.deepEqual(parsed.force, true);
  assert.deepEqual(parsed.dryRun, true);
});

test("parseArgs parses list json mode", () => {
  const parsed = parseArgs(["list", "--json"]);
  assert.deepEqual(parsed.command, "list");
  assert.deepEqual(parsed.positional, []);
  assert.deepEqual(parsed.json, true);
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
    /matches multiple remote branches/,
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
  assert.deepEqual(getComparisonRef({ path: "/parent/repo-detached-abc", detached: true }), "HEAD");
  assert.deepEqual(
    getComparisonRef({ path: "/parent/repo-release-fix", detached: false }, null),
    "origin/main",
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
