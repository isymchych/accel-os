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

const assert = (condition: boolean, message = "Assertion failed"): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEquals = <T>(actual: T, expected: T): void => {
  const same = Object.is(actual, expected) ||
    JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    throw new Error(
      `Expected ${JSON.stringify(expected, null, 2)}, got ${
        JSON.stringify(actual, null, 2)
      }`,
    );
  }
};

const assertThrows = (fn: () => unknown, expectedMessagePart: string): void => {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("Expected Error instance");
    }
    assert(
      error.message.includes(expectedMessagePart),
      `Expected error containing ${JSON.stringify(expectedMessagePart)}, got ${
        JSON.stringify(error.message)
      }`,
    );
    return;
  }

  throw new Error(
    `Expected function to throw ${JSON.stringify(expectedMessagePart)}`,
  );
};

Deno.test("parseArgs parses create flags including dry-run, repo, and path override", () => {
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

  assertEquals(parsed.command, "new-branch");
  assertEquals(parsed.positional, ["feature/test"]);
  assertEquals(parsed.fromRef, "origin/main");
  assertEquals(parsed.pathOverride, "custom/worktree");
  assertEquals(parsed.repoOverride, "../target-repo");
  assertEquals(parsed.dryRun, true);
  assertEquals(parsed.runSetup, false);
});

Deno.test("parseArgs rejects empty path overrides", () => {
  assertThrows(
    () => parseArgs(["checkout", "main", "--path="]),
    'Option "--path" requires a directory value.',
  );
});

Deno.test("parseArgs rejects empty repo overrides", () => {
  assertThrows(
    () => parseArgs(["list", "--repo="]),
    'Option "--repo" requires a directory value.',
  );
});

Deno.test("parseArgs parses remove dry-run flags", () => {
  const parsed = parseArgs(["remove", "../PAB-demo", "--force", "--dry-run"]);
  assertEquals(parsed.command, "remove");
  assertEquals(parsed.positional, ["../PAB-demo"]);
  assertEquals(parsed.force, true);
  assertEquals(parsed.dryRun, true);
});

Deno.test("parseArgs parses list json mode", () => {
  const parsed = parseArgs(["list", "--json"]);
  assertEquals(parsed.command, "list");
  assertEquals(parsed.positional, []);
  assertEquals(parsed.json, true);
});

Deno.test("repo targeting uses AI_CWD by default and resolves relative --repo from it", () => {
  assertEquals(
    getInvocationDirectory("/accel-os/scripts", "/work/project"),
    "/work/project",
  );
  assertEquals(getInvocationDirectory("/work/project", null), "/work/project");
  assertEquals(resolveRepoSearchStart("/work/project", null), "/work/project");
  assertEquals(
    resolveRepoSearchStart("/work/project", "../other"),
    "/work/other",
  );
  assertEquals(
    resolveRepoSearchStart("/work/project", "/tmp/repo"),
    "/tmp/repo",
  );
});

Deno.test("resolveRemoteBranchFromRefs accepts slash-named remote branches by branch name", () => {
  const remoteRefs = [
    "origin/main",
    "origin/change-rank",
    "origin/1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
    "upstream/change-rank",
  ];

  assertEquals(
    resolveRemoteBranchFromRefs(
      remoteRefs,
      "1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
    ),
    {
      remoteRef:
        "origin/1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
      localBranchName:
        "1331-інструмент-слідкування-за-виплатами-по-контракту-18/24",
    },
  );
});

Deno.test("resolveRemoteBranchFromRefs rejects ambiguous branch names across remotes", () => {
  const remoteRefs = ["origin/change-rank", "upstream/change-rank"];
  assertThrows(
    () => resolveRemoteBranchFromRefs(remoteRefs, "change-rank"),
    "matches multiple remote branches",
  );
});

Deno.test("resolveRemoteBranchFromRefs preserves explicit remote refs", () => {
  assertEquals(
    resolveRemoteBranchFromRefs(["origin/change-rank"], "origin/change-rank"),
    {
      remoteRef: "origin/change-rank",
      localBranchName: "change-rank",
    },
  );
});

Deno.test("explicit remote checkout requests are remote-first", () => {
  assertEquals(
    isExplicitRemoteBranchRequest("origin/change-rank", {
      remoteRef: "origin/change-rank",
    }),
    true,
  );
  assertEquals(
    isExplicitRemoteBranchRequest("change-rank", {
      remoteRef: "origin/change-rank",
    }),
    false,
  );
});

Deno.test("resolveRemoteBranchFromRefs returns null when no remote branch matches", () => {
  assertEquals(
    resolveRemoteBranchFromRefs(["origin/main"], "missing-branch"),
    null,
  );
});

Deno.test("path planning uses sibling defaults and respects overrides", () => {
  assertEquals(
    resolveCreateWorktreePath("/parent/PAB", "../PAB-demo", null),
    "/parent/PAB-demo",
  );
  assertEquals(
    resolveCreateWorktreePath("/repo", "../repo-demo", "tmp/demo"),
    "/repo/tmp/demo",
  );
  assertEquals(
    resolveCreateWorktreePath("/repo", "../repo-demo", "/tmp/custom-demo"),
    "/tmp/custom-demo",
  );
});

Deno.test("sanitizePathToken stays predictable", () => {
  assertEquals(sanitizePathToken("feature/foo bar"), "feature-foo-bar");
  assertEquals(sanitizePathToken("🔥/💥"), "ref");
});

Deno.test("PR and detached helpers preserve source semantics", () => {
  assertEquals(resolvePrHeadSource("change-rank"), "origin/change-rank");
  assert(
    formatExistingLocalBranchConflict(
      "change-rank",
      "remote ref origin/change-rank",
    ).includes(
      'Local branch "change-rank" already exists',
    ),
  );
  assert(
    formatExistingLocalBranchConflict(
      "change-rank",
      "fetched PR head origin/change-rank",
    ).includes("refusing to create or reuse it"),
  );
  assertEquals(
    getComparisonRef({ path: "/parent/repo-detached-abc", detached: true }),
    "HEAD",
  );
  assertEquals(
    getComparisonRef(
      { path: "/parent/repo-release-fix", detached: false },
      null,
    ),
    "origin/main",
  );
});

Deno.test("removal helpers resolve targets and changed-state rules", () => {
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

  assertEquals(
    resolveRemovalTarget(
      [branchStatus, detachedStatus],
      "/repo",
      "change-rank",
    ),
    branchStatus,
  );
  assertEquals(
    resolveRemovalTarget(
      [branchStatus, detachedStatus],
      "/repo",
      "/parent/repo-detached-abc",
    ),
    detachedStatus,
  );
  assertEquals(hasChanges(branchStatus), false);
  assertEquals(hasChanges({ ...detachedStatus, dirty: false }), true);
  assertEquals(hasChanges({ ...branchStatus, untracked: true }), true);
  assertEquals(hasChanges({ ...branchStatus, localCommits: 2 }), true);
  assertEquals(
    getBranchDeletionFlag({ ...branchStatus, localCommits: 0 }, false),
    "-d",
  );
  assertEquals(
    getBranchDeletionFlag({ ...branchStatus, localCommits: 2 }, false),
    "-D",
  );
  assertEquals(
    getBranchDeletionFlag({ ...branchStatus, localCommits: 0 }, true),
    "-D",
  );
});

Deno.test("reusable worktree detection works for branch and detached targets", () => {
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

  assertEquals(
    isReusableExistingWorktree(branchWorktree, {
      kind: "branch",
      worktreePath: "/parent/repo-change-rank",
      branchName: "change-rank",
      createArgs: [],
      displaySource: "change-rank",
    }),
    true,
  );
  assertEquals(
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

Deno.test("display helpers stay predictable", () => {
  const branchWorktree = {
    path: "/parent/repo-change-rank",
    head: "abc",
    branchRef: "refs/heads/change-rank",
    branchName: "change-rank",
    detached: false,
  };

  assertEquals(
    formatDisplayPath("/repo", "/parent/repo-change-rank"),
    "/parent/repo-change-rank",
  );
  assertEquals(formatDisplayPath("/repo", "/tmp/external"), "/tmp/external");
  assertEquals(getWorktreePathKind("/repo", branchWorktree), "custom");
  assertEquals(
    getWorktreePathKind("/repo", {
      ...branchWorktree,
      path: "/repo/.tmp-worktrees/change-rank",
    }),
    "custom",
  );
  assertEquals(
    getWorktreePathKind("/parent/repo", {
      ...branchWorktree,
      path: "/parent/repo-change-rank",
    }),
    "default",
  );
  assertEquals(toYesNo(true), "yes");
  assertEquals(toYesNo(false), "no");
});

Deno.test("buildWorktreeListRows produces rich rows", () => {
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

  assertEquals(buildWorktreeListRows("/repo", [branchStatus, detachedStatus]), [
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

Deno.test("creation collision helpers distinguish reuse, path conflicts, branch conflicts, and create-new", () => {
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

  assertEquals(
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
  assertEquals(
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
  assertEquals(
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
  assertEquals(
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
  assertEquals(
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
