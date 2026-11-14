import * as path from "node:path";
import process from "node:process";

import { getErrorMessage, isPresent } from "@accel-os/shared/guards";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Exit, FileSystem, Schema, Stdio, Stream, Terminal } from "effect";
import type { PlatformError } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { logEvent, withExecutionLog } from "../lib/execution-log.ts";

/**
 * Repo-local Git worktree helper.
 *
 * Behavioral contract:
 * - `list` shows each linked worktree with the same conservative status model used by `remove`
 *   (`comparison` is the branch upstream when present, otherwise `origin/main`; detached
 *   worktrees always require removal confirmation)
 * - `checkout <ref>` creates `../<repo>-<branch>` for local/remote branches, or a detached
 *   `../<repo>-detached-<ref>` worktree for tags/commits; remote-tracking refs create a local
 *   branch when the local branch name is unambiguous; if the target local branch already exists,
 *   the command fails instead of implicitly reusing or resetting it
 * - `new-branch <branch> --from <ref>` creates `../<repo>-<branch>` as a new branch from the
 *   provided base ref
 * - `new-from-main <branch>` fetches `origin/main`, then behaves like
 *   `new-branch <branch> --from origin/main`
 * - create commands run `setup-worktree.sh <worktree-path>` from the repo root when that
 *   script exists, unless `--no-setup` is provided
 * - `new-from-pr <url-or-number>` resolves same-repo PR metadata via `gh`, fetches the PR head
 *   branch from `origin`, and creates `../<repo>-<head-branch>` only when no same-named local
 *   branch already exists
 * - `remove <branch-or-path>` resolves by exact branch first and then by exact path; it refuses to
 *   remove the current worktree or the primary checkout and prompts before deleting a worktree that
 *   has tracked changes, untracked files, or local commits
 * - `--delete-branch` deletes the local branch only after successful worktree removal
 * - repo selection defaults to `AI_CWD` when present, otherwise the current working directory;
 *   `--repo <path>` overrides that starting directory explicitly
 */
type WorktreeOperation<A, R = never> = Effect.Effect<
  A,
  Error | PlatformError.PlatformError | Terminal.QuitError,
  ChildProcessSpawner.ChildProcessSpawner | Stdio.Stdio | R
>;

interface RepoIdentity {
  readonly owner: string;
  readonly name: string;
  readonly nameWithOwner: string;
}

interface CommandContext {
  readonly repoRoot: string;
  readonly primaryWorktreeRoot: string;
  readonly currentWorktreeRoot: string;
  readonly repoIdentity: RepoIdentity;
}

interface WorktreeRecord {
  readonly path: string;
  readonly head: string | null;
  readonly branchRef: string | null;
  readonly branchName: string | null;
  readonly detached: boolean;
}

interface WorktreeStatus {
  readonly worktree: WorktreeRecord;
  readonly isCurrent: boolean;
  readonly isPrimary: boolean;
  readonly dirty: boolean;
  readonly untracked: boolean;
  readonly localCommits: number;
  readonly upstreamRef: string | null;
  readonly comparisonRef: string;
}

interface RunOptions {
  readonly cwd?: string;
  readonly stdio?: "inherit" | "pipe";
  readonly allowFailure?: boolean;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

interface RemoteBranchResolution {
  readonly remoteRef: string;
  readonly localBranchName: string;
}

interface PullRequestMetadata {
  readonly number: number;
  readonly headRefName: string;
  readonly isCrossRepository: boolean;
  readonly headRepository: {
    readonly name: string;
    readonly nameWithOwner: string;
    readonly ownerLogin: string;
  } | null;
}

const OptionalLoginObjectSchema = Schema.Struct({
  login: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const PullRequestMetadataJsonSchema = Schema.Struct({
  number: Schema.Number,
  headRefName: Schema.String,
  isCrossRepository: Schema.Boolean,
  headRepository: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      nameWithOwner: Schema.String,
      owner: Schema.optionalKey(Schema.NullOr(OptionalLoginObjectSchema)),
    }),
  ),
  headRepositoryOwner: Schema.optionalKey(Schema.NullOr(OptionalLoginObjectSchema)),
});

type CreateCollisionDecision =
  | {
      readonly kind: "reuse-existing";
      readonly existingWorktree: WorktreeRecord;
    }
  | {
      readonly kind: "path-conflict";
      readonly existingWorktree: WorktreeRecord;
    }
  | {
      readonly kind: "branch-conflict";
      readonly existingWorktree: WorktreeRecord;
    }
  | {
      readonly kind: "create-new";
    };

type CreationTarget =
  | {
      readonly kind: "branch";
      readonly worktreePath: string;
      readonly branchName: string;
      readonly createArgs: readonly string[];
      readonly displaySource: string;
    }
  | {
      readonly kind: "detached";
      readonly worktreePath: string;
      readonly resolvedCommit: string;
      readonly requestedRef: string;
      readonly createArgs: readonly string[];
      readonly displaySource: string;
    };

export function getInvocationDirectory(
  cwd: string = process.cwd(),
  aiCwd: string | null = process.env["AI_CWD"] ?? null,
): string {
  return aiCwd ? path.resolve(aiCwd) : path.resolve(cwd);
}

export function resolveRepoSearchStart(
  invocationDirectory: string,
  repoOverride: string | null,
): string {
  if (!repoOverride) {
    return path.resolve(invocationDirectory);
  }

  return path.isAbsolute(repoOverride)
    ? path.resolve(repoOverride)
    : path.resolve(invocationDirectory, repoOverride);
}

function buildContext(repoOverride: string | null): WorktreeOperation<CommandContext> {
  return Effect.gen(function* () {
    const invocationDirectory = getInvocationDirectory();
    const repoSearchStart = resolveRepoSearchStart(invocationDirectory, repoOverride);
    const primaryWorktreeRoot = yield* resolvePrimaryWorktreeRoot(repoSearchStart);
    const currentWorktreeRoot = yield* resolveGitTopLevel(repoSearchStart);
    const repoRoot = primaryWorktreeRoot;
    const repoIdentity = yield* resolveRepoIdentity(repoRoot);
    yield* logEvent("repo_resolved", {
      repo_root: repoRoot,
      current_worktree: currentWorktreeRoot,
    });
    return { repoRoot, primaryWorktreeRoot, currentWorktreeRoot, repoIdentity };
  });
}

function resolveGitTopLevel(cwd: string): WorktreeOperation<string> {
  return runCommand("git", ["rev-parse", "--show-toplevel"], { cwd }).pipe(
    Effect.map((result) => result.stdout.trim()),
  );
}

function resolvePrimaryWorktreeRoot(cwd: string): WorktreeOperation<string> {
  return Effect.gen(function* () {
    const result = yield* runCommand(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd,
      },
    );
    const gitCommonDir = result.stdout.trim();
    if (path.basename(gitCommonDir) !== ".git") {
      return yield* Effect.fail(
        new Error(`Expected git common dir to end with .git, got: ${gitCommonDir}`),
      );
    }
    return path.dirname(gitCommonDir);
  });
}

function resolveRepoIdentity(repoRoot: string): WorktreeOperation<RepoIdentity> {
  return runCommand("git", ["remote", "get-url", "origin"], { cwd: repoRoot }).pipe(
    Effect.flatMap((result) =>
      Effect.try({
        try: () => parseRepoIdentity(result.stdout.trim()),
        catch: (cause) => new Error(getErrorMessage(cause), { cause }),
      }),
    ),
  );
}

function parseRepoIdentity(remoteUrl: string): RepoIdentity {
  const normalizedUrl = remoteUrl.replace(/\.git$/u, "");

  const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/](.+)\/(.+)$/u.exec(normalizedUrl);
  if (sshMatch) {
    const owner = sshMatch[1];
    const name = sshMatch[2];
    if (owner === undefined || name === undefined) {
      throw new Error(`Unsupported GitHub origin URL: ${remoteUrl}`);
    }
    return { owner, name, nameWithOwner: `${owner}/${name}` };
  }

  const httpsMatch = /^https:\/\/github\.com\/(.+)\/(.+)$/u.exec(normalizedUrl);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const name = httpsMatch[2];
    if (owner === undefined || name === undefined) {
      throw new Error(`Unsupported GitHub origin URL: ${remoteUrl}`);
    }
    return { owner, name, nameWithOwner: `${owner}/${name}` };
  }

  throw new Error(`Unsupported GitHub origin URL: ${remoteUrl}`);
}

interface WorktreeListRow {
  readonly branch: string;
  readonly source: "branch" | "detached";
  readonly pathKind: "default" | "custom";
  readonly upstream: string;
  readonly comparison: string;
  readonly path: string;
  readonly dirty: string;
  readonly untracked: string;
  readonly localCommits: string;
  readonly current: string;
  readonly primary: string;
}

function runList(context: CommandContext, json: boolean): WorktreeOperation<void> {
  return Effect.gen(function* () {
    const statuses = yield* collectWorktreeStatuses(context);

    if (statuses.length === 0) {
      yield* Console.log(json ? "[]" : "No worktrees found.");
      return;
    }

    const rows = buildWorktreeListRows(context.repoRoot, statuses);
    if (json) {
      yield* Console.log(JSON.stringify(rows, null, 2));
      return;
    }

    const headers: (keyof WorktreeListRow)[] = [
      "branch",
      "source",
      "pathKind",
      "upstream",
      "comparison",
      "path",
      "dirty",
      "untracked",
      "localCommits",
      "current",
      "primary",
    ];

    const widths = headers.map((header) =>
      Math.max(header.length, ...rows.map((row) => row[header].length)),
    );

    const headerLine = headers
      .map((header, index) => header.padEnd(widths[index] ?? header.length))
      .join("  ");
    const separatorLine = widths.map((width) => "-".repeat(width)).join("  ");

    yield* Console.log(`${headerLine}\n${separatorLine}`);
    for (const row of rows) {
      const line = headers
        .map((header, index) => row[header].padEnd(widths[index] ?? header.length))
        .join("  ");
      yield* Console.log(line);
    }
  });
}

function runCheckout(
  context: CommandContext,
  requestedRef: string,
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const target = yield* resolveCheckoutTarget(context, requestedRef, pathOverride);
    yield* createOrReuseWorktree(context, target, runSetup, dryRun);
  });
}

function runNewBranch(
  context: CommandContext,
  branchName: string,
  fromRef: string | null,
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  if (!fromRef) {
    return Effect.fail(new Error('Command "new-branch" requires "--from <ref>".'));
  }

  const target = buildNewBranchTarget(context, branchName, fromRef, pathOverride);
  return createOrReuseWorktree(context, target, runSetup, dryRun);
}

function runNewFromMain(
  context: CommandContext,
  branchName: string,
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (dryRun) {
      yield* Console.log("Dry run only. Skipping fetch for origin/main.");
    } else {
      yield* Console.log("Fetching origin/main...");
      yield* runCommand("git", ["fetch", "origin", "main"], {
        cwd: context.repoRoot,
        stdio: "inherit",
      });
    }

    const target = buildNewBranchTarget(context, branchName, "origin/main", pathOverride);
    yield* createOrReuseWorktree(context, target, runSetup, dryRun);
  });
}

function runNewFromPr(
  context: CommandContext,
  prSelector: string,
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const metadata = yield* resolvePullRequestMetadata(context, prSelector);

    if (metadata.isCrossRepository) {
      yield* Effect.fail(
        new Error(
          `PR #${metadata.number} comes from a fork/cross-repo branch; only same-repo PRs are supported.`,
        ),
      );
    }

    const headRepository = metadata.headRepository;
    if (headRepository?.nameWithOwner !== context.repoIdentity.nameWithOwner) {
      yield* Effect.fail(
        new Error(
          `PR #${metadata.number} head repository does not match ${context.repoIdentity.nameWithOwner}.`,
        ),
      );
    }

    if (dryRun) {
      yield* Console.log(`Dry run only. Skipping fetch for origin/${metadata.headRefName}.`);
    } else {
      yield* Console.log(`Fetching origin/${metadata.headRefName}...`);
      yield* runCommand("git", ["fetch", "origin", metadata.headRefName], {
        cwd: context.repoRoot,
        stdio: "inherit",
      });
    }

    const existingLocalHeadBranch = yield* resolveExistingLocalBranch(
      context.repoRoot,
      metadata.headRefName,
    );
    if (existingLocalHeadBranch) {
      yield* Effect.fail(
        new Error(
          formatExistingLocalBranchConflict(
            existingLocalHeadBranch,
            `fetched PR head origin/${metadata.headRefName}`,
          ),
        ),
      );
    }

    const target = buildBranchTarget(
      context,
      metadata.headRefName,
      resolvePrHeadSource(metadata.headRefName),
      false,
      pathOverride,
    );
    yield* createOrReuseWorktree(context, target, runSetup, dryRun);
  });
}

function resolvePullRequestMetadata(
  context: CommandContext,
  prSelector: string,
): WorktreeOperation<PullRequestMetadata> {
  return runCommand(
    "gh",
    [
      "pr",
      "view",
      prSelector,
      "--json",
      "number,headRefName,isCrossRepository,headRepository,headRepositoryOwner",
    ],
    {
      cwd: context.repoRoot,
    },
  ).pipe(
    Effect.flatMap((result) =>
      Effect.try({
        try: () => parsePullRequestMetadataJson(result.stdout, context.repoIdentity.owner),
        catch: (cause) => new Error(getErrorMessage(cause), { cause }),
      }),
    ),
  );
}

export function parsePullRequestMetadataJson(
  json: string,
  fallbackOwnerLogin: string,
): PullRequestMetadata {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error("gh PR metadata: invalid JSON syntax", { cause: error });
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const allowed = new Set([
      "number",
      "headRefName",
      "isCrossRepository",
      "headRepository",
      "headRepositoryOwner",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new Error("gh PR metadata: invalid JSON: unexpected top-level field");
    }
  }
  let parsed: typeof PullRequestMetadataJsonSchema.Type;
  try {
    parsed = Schema.decodeUnknownSync(PullRequestMetadataJsonSchema)(value);
  } catch (error) {
    throw new Error(`gh PR metadata: invalid JSON: ${getErrorMessage(error)}`, { cause: error });
  }

  return {
    number: parsed.number,
    headRefName: parsed.headRefName,
    isCrossRepository: parsed.isCrossRepository,
    headRepository: parsed.headRepository
      ? {
          name: parsed.headRepository.name,
          nameWithOwner: parsed.headRepository.nameWithOwner,
          ownerLogin:
            parsed.headRepository.owner?.login ??
            parsed.headRepositoryOwner?.login ??
            fallbackOwnerLogin,
        }
      : null,
  };
}

export function resolvePrHeadSource(headRefName: string): string {
  return `origin/${headRefName}`;
}

export function isExplicitRemoteBranchRequest(
  requestedRef: string,
  remoteBranch: Pick<RemoteBranchResolution, "remoteRef"> | null,
): boolean {
  return requestedRef === remoteBranch?.remoteRef;
}

function resolveCheckoutTarget(
  context: CommandContext,
  requestedRef: string,
  pathOverride: string | null,
): WorktreeOperation<CreationTarget> {
  return Effect.gen(function* () {
    const remoteBranch = yield* resolveRemoteBranch(context.repoRoot, requestedRef);
    if (remoteBranch && isExplicitRemoteBranchRequest(requestedRef, remoteBranch)) {
      const existingLocalBranch = yield* resolveExistingLocalBranch(
        context.repoRoot,
        remoteBranch.localBranchName,
      );
      if (existingLocalBranch) {
        return yield* Effect.fail(
          new Error(
            formatExistingLocalBranchConflict(
              existingLocalBranch,
              `remote ref ${remoteBranch.remoteRef}`,
            ),
          ),
        );
      }

      return buildBranchTarget(
        context,
        remoteBranch.localBranchName,
        remoteBranch.remoteRef,
        false,
        pathOverride,
      );
    }

    const localBranch = yield* resolveExistingLocalBranch(context.repoRoot, requestedRef);
    if (localBranch) {
      return buildBranchTarget(context, localBranch, localBranch, false, pathOverride);
    }

    if (remoteBranch) {
      const localBranchFromRemote = yield* resolveExistingLocalBranch(
        context.repoRoot,
        remoteBranch.localBranchName,
      );
      if (localBranchFromRemote) {
        return buildBranchTarget(
          context,
          localBranchFromRemote,
          localBranchFromRemote,
          false,
          pathOverride,
        );
      }

      return buildBranchTarget(
        context,
        remoteBranch.localBranchName,
        remoteBranch.remoteRef,
        false,
        pathOverride,
      );
    }

    if (yield* refExists(context.repoRoot, `refs/tags/${requestedRef}`)) {
      const resolvedCommit = yield* resolveCommitish(context.repoRoot, requestedRef);
      return buildDetachedTarget(context, requestedRef, resolvedCommit, pathOverride);
    }

    const resolvedCommit = yield* tryResolveCommitish(context.repoRoot, requestedRef);
    if (resolvedCommit) {
      return buildDetachedTarget(context, requestedRef, resolvedCommit, pathOverride);
    }

    return yield* Effect.fail(new Error(`Could not resolve ref: ${requestedRef}`));
  });
}

export function formatExistingLocalBranchConflict(
  branchName: string,
  sourceDescription: string,
): string {
  return `Local branch "${branchName}" already exists; refusing to create or reuse it from ${sourceDescription}. Remove the local branch or choose a different workflow.`;
}

function buildNewBranchTarget(
  context: CommandContext,
  branchName: string,
  fromRef: string,
  pathOverride: string | null,
): CreationTarget {
  return buildBranchTarget(context, branchName, fromRef, true, pathOverride);
}

function buildBranchTarget(
  context: CommandContext,
  branchName: string,
  sourceRef: string,
  createNewBranch = false,
  pathOverride: string | null = null,
): CreationTarget {
  const worktreePath = getBranchWorktreePath(context.repoRoot, branchName, pathOverride);
  const createArgs = createNewBranch
    ? ["worktree", "add", "-b", branchName, worktreePath, sourceRef]
    : ["worktree", "add", worktreePath, branchName];

  const actualCreateArgs =
    !createNewBranch && sourceRef !== branchName
      ? ["worktree", "add", "-b", branchName, worktreePath, sourceRef]
      : createArgs;

  return {
    kind: "branch",
    worktreePath,
    branchName,
    createArgs: actualCreateArgs,
    displaySource: sourceRef,
  };
}

function buildDetachedTarget(
  context: CommandContext,
  requestedRef: string,
  resolvedCommit: string,
  pathOverride: string | null,
): CreationTarget {
  const worktreePath = getDetachedWorktreePath(context.repoRoot, requestedRef, pathOverride);

  return {
    kind: "detached",
    worktreePath,
    resolvedCommit,
    requestedRef,
    createArgs: ["worktree", "add", "--detach", worktreePath, resolvedCommit],
    displaySource: requestedRef,
  };
}

function createOrReuseWorktree(
  context: CommandContext,
  target: CreationTarget,
  runSetup: boolean,
  dryRun: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const existingWorktrees = yield* listWorktrees(context.repoRoot);
    const collisionDecision = evaluateCreateCollision(existingWorktrees, target);
    yield* logEvent("creation_planned", {
      target_path: target.worktreePath,
      source: target.displaySource,
      decision: collisionDecision.kind,
      dry_run: dryRun,
      run_setup: runSetup,
    });

    if (collisionDecision.kind === "reuse-existing") {
      yield* Console.log(
        `already exists: ${formatDisplayPath(
          context.repoRoot,
          collisionDecision.existingWorktree.path,
        )}`,
      );
      return;
    }

    if (collisionDecision.kind === "path-conflict") {
      yield* Effect.fail(
        new Error(
          `Target path already belongs to a different worktree: ${formatDisplayPath(
            context.repoRoot,
            collisionDecision.existingWorktree.path,
          )}`,
        ),
      );
    }

    if (collisionDecision.kind === "branch-conflict") {
      yield* Effect.fail(
        new Error(
          `Branch "${
            target.kind === "branch" ? target.branchName : "(detached)"
          }" is already checked out in ${formatDisplayPath(
            context.repoRoot,
            collisionDecision.existingWorktree.path,
          )}.`,
        ),
      );
    }

    if (yield* fs.exists(target.worktreePath)) {
      yield* Effect.fail(
        new Error(
          `Target path exists but is not a registered worktree: ${formatDisplayPath(
            context.repoRoot,
            target.worktreePath,
          )}. Remove it or choose a different target.`,
        ),
      );
    }

    if (dryRun) {
      yield* printDryRunPlan(context.repoRoot, target, runSetup);
      return;
    }

    yield* fs.makeDirectory(path.dirname(target.worktreePath), { recursive: true });

    yield* Console.log(
      `Creating worktree at ${formatDisplayPath(
        context.repoRoot,
        target.worktreePath,
      )} from ${target.displaySource}...`,
    );
    yield* runCommand("git", target.createArgs, {
      cwd: context.repoRoot,
      stdio: "inherit",
    });

    yield* logEvent("worktree_created", { target_path: target.worktreePath });
    yield* runSetupWorktreeHookIfPresent(context.repoRoot, target.worktreePath, runSetup);
  });
}

export function evaluateCreateCollision(
  existingWorktrees: readonly WorktreeRecord[],
  target: CreationTarget,
): CreateCollisionDecision {
  const existingByPath = existingWorktrees.find((worktree) =>
    areSamePath(worktree.path, target.worktreePath),
  );

  if (existingByPath) {
    if (isReusableExistingWorktree(existingByPath, target)) {
      return {
        kind: "reuse-existing",
        existingWorktree: existingByPath,
      };
    }

    return {
      kind: "path-conflict",
      existingWorktree: existingByPath,
    };
  }

  if (target.kind === "branch") {
    const existingBranchWorktree = existingWorktrees.find(
      (worktree) =>
        worktree.branchName === target.branchName &&
        !areSamePath(worktree.path, target.worktreePath),
    );

    if (existingBranchWorktree) {
      return {
        kind: "branch-conflict",
        existingWorktree: existingBranchWorktree,
      };
    }
  }

  return {
    kind: "create-new",
  };
}

export function isReusableExistingWorktree(
  existingWorktree: WorktreeRecord,
  target: CreationTarget,
): boolean {
  if (target.kind === "branch") {
    return existingWorktree.branchName === target.branchName;
  }

  return existingWorktree.detached && existingWorktree.head === target.resolvedCommit;
}

function resolveExistingLocalBranch(
  repoRoot: string,
  branchName: string,
): WorktreeOperation<string | null> {
  return refExists(repoRoot, `refs/heads/${branchName}`).pipe(
    Effect.map((exists) => (exists ? branchName : null)),
  );
}

function resolveRemoteBranch(
  repoRoot: string,
  requestedRef: string,
): WorktreeOperation<RemoteBranchResolution | null> {
  return listRemoteTrackingRefs(repoRoot).pipe(
    Effect.flatMap((remoteRefs) =>
      Effect.try({
        try: () => resolveRemoteBranchFromRefs(remoteRefs, requestedRef),
        catch: (cause) => new Error(getErrorMessage(cause), { cause }),
      }),
    ),
  );
}

export function resolveRemoteBranchFromRefs(
  remoteRefs: readonly string[],
  requestedRef: string,
): RemoteBranchResolution | null {
  if (remoteRefs.includes(requestedRef)) {
    return {
      remoteRef: requestedRef,
      localBranchName: deriveLocalBranchNameFromRemoteRef(requestedRef),
    };
  }

  const matches = remoteRefs.filter(
    (remoteRef) => deriveLocalBranchNameFromRemoteRef(remoteRef) === requestedRef,
  );
  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new Error(
      `Ref "${requestedRef}" matches multiple remote branches: ${matches.join(
        ", ",
      )}. Use an explicit remote ref.`,
    );
  }

  const remoteRef = matches[0];
  if (remoteRef === undefined) {
    return null;
  }

  return {
    remoteRef,
    localBranchName: deriveLocalBranchNameFromRemoteRef(remoteRef),
  };
}

function deriveLocalBranchNameFromRemoteRef(remoteRef: string): string {
  const separatorIndex = remoteRef.indexOf("/");
  if (separatorIndex === -1 || separatorIndex === remoteRef.length - 1) {
    throw new Error(`Expected remote ref in "<remote>/<branch>" form, got: ${remoteRef}`);
  }

  return remoteRef.slice(separatorIndex + 1);
}

function listRemoteTrackingRefs(repoRoot: string): WorktreeOperation<string[]> {
  return runCommand("git", ["for-each-ref", "--format=%(refname:strip=2)", "refs/remotes"], {
    cwd: repoRoot,
  }).pipe(
    Effect.map(({ stdout }) =>
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.endsWith("/HEAD")),
    ),
  );
}

function refExists(repoRoot: string, ref: string): WorktreeOperation<boolean> {
  return runCommand("git", ["show-ref", "--verify", "--quiet", ref], {
    cwd: repoRoot,
    allowFailure: true,
  }).pipe(Effect.map((result) => result.status === 0));
}

function resolveCommitish(repoRoot: string, ref: string): WorktreeOperation<string> {
  return Effect.gen(function* () {
    const resolved = yield* tryResolveCommitish(repoRoot, ref);
    if (!resolved) {
      return yield* Effect.fail(new Error(`Could not resolve commit-ish: ${ref}`));
    }

    return resolved;
  });
}

function tryResolveCommitish(repoRoot: string, ref: string): WorktreeOperation<string | null> {
  return runCommand("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: repoRoot,
    allowFailure: true,
  }).pipe(Effect.map((result) => (result.status === 0 ? result.stdout.trim() : null)));
}

export function resolveCreateWorktreePath(
  repoRoot: string,
  defaultRelativePath: string,
  pathOverride: string | null,
): string {
  if (!pathOverride) {
    return path.join(repoRoot, defaultRelativePath);
  }

  return path.isAbsolute(pathOverride)
    ? path.resolve(pathOverride)
    : path.resolve(repoRoot, pathOverride);
}

function getDefaultBranchWorktreeRelativePath(repoRoot: string, branchName: string): string {
  return path.join("..", `${path.basename(repoRoot)}-${branchName}`);
}

function getDefaultDetachedWorktreeRelativePath(repoRoot: string, requestedRef: string): string {
  return path.join("..", `${path.basename(repoRoot)}-detached-${sanitizePathToken(requestedRef)}`);
}

function getBranchWorktreePath(
  repoRoot: string,
  branchName: string,
  pathOverride: string | null,
): string {
  return resolveCreateWorktreePath(
    repoRoot,
    getDefaultBranchWorktreeRelativePath(repoRoot, branchName),
    pathOverride,
  );
}

function getDetachedWorktreePath(
  repoRoot: string,
  requestedRef: string,
  pathOverride: string | null,
): string {
  return resolveCreateWorktreePath(
    repoRoot,
    getDefaultDetachedWorktreeRelativePath(repoRoot, requestedRef),
    pathOverride,
  );
}

export function sanitizePathToken(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return normalized.length > 0 ? normalized : "ref";
}

function runRemove(
  context: CommandContext,
  targetArg: string,
  deleteBranch: boolean,
  force: boolean,
  dryRun: boolean,
): WorktreeOperation<void, Terminal.Terminal> {
  return Effect.gen(function* () {
    const statuses = yield* collectWorktreeStatuses(context);
    const target = yield* Effect.try({
      try: () => resolveRemovalTarget(statuses, context.repoRoot, targetArg),
      catch: (cause) => new Error(getErrorMessage(cause), { cause }),
    });

    if (target.isCurrent) {
      yield* Effect.fail(
        new Error(`Refusing to remove the current worktree: ${target.worktree.path}`),
      );
    }

    if (target.isPrimary) {
      yield* Effect.fail(
        new Error(`Refusing to remove the primary repository checkout: ${target.worktree.path}`),
      );
    }
    yield* logEvent("removal_planned", {
      target_path: target.worktree.path,
      branch: target.worktree.branchName,
      dirty: target.dirty,
      untracked: target.untracked,
      local_commits: target.localCommits,
      detached: target.worktree.detached,
      force,
      dry_run: dryRun,
      delete_branch: deleteBranch,
    });

    const dirtyRemovalConfirmed = force
      ? hasChanges(target)
      : dryRun
        ? hasChanges(target)
        : hasChanges(target)
          ? yield* confirmDirtyRemoval(context.repoRoot, target)
          : false;
    if (!dryRun && hasChanges(target) && !dirtyRemovalConfirmed) {
      return;
    }

    if (dryRun) {
      yield* Console.log("Dry run only. No changes were made.");
      yield* Console.log(
        `Would remove: ${formatDisplayPath(context.repoRoot, target.worktree.path)}`,
      );
      yield* Console.log(`Force remove: ${toYesNo(dirtyRemovalConfirmed)}`);
      yield* Console.log(
        `Delete branch: ${
          deleteBranch && target.worktree.branchName ? target.worktree.branchName : "no"
        }`,
      );
      return;
    }

    yield* Console.log(
      `Removing worktree ${formatDisplayPath(context.repoRoot, target.worktree.path)}...`,
    );
    const removeArgs = dirtyRemovalConfirmed
      ? ["worktree", "remove", "--force", target.worktree.path]
      : ["worktree", "remove", target.worktree.path];
    yield* runCommand("git", removeArgs, {
      cwd: context.repoRoot,
      stdio: "inherit",
    });
    yield* logEvent("worktree_removed", { target_path: target.worktree.path });

    if (deleteBranch && target.worktree.branchName) {
      yield* Console.log(`Deleting branch ${target.worktree.branchName}...`);
      const deleteBranchFlag = getBranchDeletionFlag(target, force);
      yield* runCommand("git", ["branch", deleteBranchFlag, target.worktree.branchName], {
        cwd: context.repoRoot,
        stdio: "inherit",
      });
      yield* logEvent("branch_deleted", { branch: target.worktree.branchName });
    }
  });
}

export function getBranchDeletionFlag(status: WorktreeStatus, force: boolean): "-d" | "-D" {
  return force || status.localCommits > 0 ? "-D" : "-d";
}

function confirmDirtyRemoval(
  repoRoot: string,
  status: WorktreeStatus,
): WorktreeOperation<boolean, Terminal.Terminal> {
  return Effect.gen(function* () {
    if (!hasChanges(status)) {
      return false;
    }

    const details = [
      status.worktree.detached ? "detached HEAD (commits may be unpublished)" : null,
      status.dirty ? "tracked changes" : null,
      status.untracked ? "untracked files" : null,
      status.localCommits > 0 ? `${status.localCommits} local commit(s)` : null,
    ].filter(isPresent);

    const confirmed = yield* confirmDestructiveAction(
      `Worktree ${formatDisplayPath(repoRoot, status.worktree.path)} has ${details.join(
        ", ",
      )}. Remove it? [y/N] `,
    );
    if (!confirmed) {
      yield* Console.log("Removal cancelled.");
      yield* logEvent("removal_declined", { target_path: status.worktree.path });
      return false;
    }

    return true;
  });
}

function runSetupWorktreeHookIfPresent(
  repoRoot: string,
  worktreePath: string,
  runSetup: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const setupScriptPath = path.join(repoRoot, "setup-worktree.sh");

    if (!(yield* fs.exists(setupScriptPath))) {
      yield* Console.log("No setup-worktree.sh found. Skipping post-create setup.");
      return;
    }

    if (!runSetup) {
      yield* Console.log("Skipped setup-worktree.sh because --no-setup was provided.");
      return;
    }

    yield* Console.log("Running setup-worktree.sh...");
    yield* runCommand("bash", ["./setup-worktree.sh", worktreePath], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  });
}

export function buildWorktreeListRows(
  repoRoot: string,
  statuses: readonly WorktreeStatus[],
): WorktreeListRow[] {
  return statuses.map((status) => ({
    branch: status.worktree.branchName ?? "(detached)",
    source: status.worktree.detached ? "detached" : "branch",
    pathKind: getWorktreePathKind(repoRoot, status.worktree),
    upstream: status.upstreamRef ?? "(none)",
    comparison: status.comparisonRef,
    path: formatDisplayPath(repoRoot, status.worktree.path),
    dirty: toYesNo(status.dirty),
    untracked: toYesNo(status.untracked),
    localCommits: status.worktree.detached ? "n/a" : String(status.localCommits),
    current: toYesNo(status.isCurrent),
    primary: toYesNo(status.isPrimary),
  }));
}

function collectWorktreeStatuses(context: CommandContext): WorktreeOperation<WorktreeStatus[]> {
  return Effect.gen(function* () {
    const worktrees = yield* listWorktrees(context.repoRoot);
    const statuses: WorktreeStatus[] = [];
    for (const worktree of worktrees) {
      const { stdout: statusOutput } = yield* runCommand(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        {
          cwd: worktree.path,
        },
      );

      const statusLines = statusOutput
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean);

      const dirty = statusLines.some((line) => !line.startsWith("??"));
      const untracked = statusLines.some((line) => line.startsWith("??"));
      const upstreamRef = yield* getUpstreamRef(worktree);
      const comparisonRef = getComparisonRef(worktree, upstreamRef);
      const localCommits = yield* getLocalCommitCount(
        worktree.path,
        comparisonRef,
        worktree.detached,
      );

      statuses.push({
        worktree,
        isCurrent: areSamePath(worktree.path, context.currentWorktreeRoot),
        isPrimary: areSamePath(worktree.path, context.primaryWorktreeRoot),
        dirty,
        untracked,
        localCommits,
        upstreamRef,
        comparisonRef,
      });
    }
    return statuses;
  });
}

function listWorktrees(repoRoot: string): WorktreeOperation<WorktreeRecord[]> {
  return runCommand("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  }).pipe(Effect.map(({ stdout }) => parseWorktrees(stdout)));
}

function parseWorktrees(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let currentPath: string | null = null;
  let head: string | null = null;
  let branchRef: string | null = null;
  let detached = false;

  const flush = (): void => {
    if (!currentPath) {
      return;
    }

    records.push({
      path: currentPath,
      head,
      branchRef,
      branchName: branchRef ? branchRef.replace(/^refs\/heads\//u, "") : null,
      detached,
    });

    currentPath = null;
    head = null;
    branchRef = null;
    detached = false;
  };

  for (const line of output.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }

    if (line.startsWith("worktree ")) {
      flush();
      currentPath = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("HEAD ")) {
      head = line.slice("HEAD ".length);
      continue;
    }

    if (line.startsWith("branch ")) {
      branchRef = line.slice("branch ".length);
      continue;
    }

    if (line === "detached") {
      detached = true;
    }
  }

  flush();
  return records;
}

function getUpstreamRef(
  worktree: Pick<WorktreeRecord, "path" | "detached">,
): WorktreeOperation<string | null> {
  return Effect.gen(function* () {
    if (worktree.detached) {
      return null;
    }

    const upstream = yield* runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      {
        cwd: worktree.path,
        allowFailure: true,
      },
    );

    if (upstream.status === 0) {
      const value = upstream.stdout.trim();
      if (value.length > 0) {
        return value;
      }
    }

    return null;
  });
}

export function getComparisonRef(
  worktree: Pick<WorktreeRecord, "path" | "detached">,
  upstreamRef: string | null,
): string {
  if (worktree.detached) {
    return "HEAD";
  }

  return upstreamRef ?? "origin/main";
}

function getLocalCommitCount(
  worktreePath: string,
  comparisonRef: string,
  detached: boolean,
): WorktreeOperation<number> {
  return Effect.gen(function* () {
    if (detached || comparisonRef === "HEAD") {
      return 0;
    }

    const result = yield* runCommand("git", ["rev-list", "--count", `${comparisonRef}..HEAD`], {
      cwd: worktreePath,
      allowFailure: true,
    });

    if (result.status !== 0) {
      return 0;
    }

    const parsed = Number(result.stdout.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

/**
 * Resolves the remove target with a predictable priority order so callers can use either the branch
 * name or the path without ambiguity in the common case.
 */
export function resolveRemovalTarget(
  statuses: readonly WorktreeStatus[],
  repoRoot: string,
  targetArg: string,
): WorktreeStatus {
  const byBranch = statuses.find((status) => status.worktree.branchName === targetArg);
  if (byBranch) {
    return byBranch;
  }

  const absoluteTargetPath = path.isAbsolute(targetArg)
    ? path.resolve(targetArg)
    : path.resolve(repoRoot, targetArg);

  const byPath = statuses.find((status) => areSamePath(status.worktree.path, absoluteTargetPath));
  if (byPath) {
    return byPath;
  }

  throw new Error(`Could not find worktree by branch or path: ${targetArg}`);
}

/**
 * This is the canonical deletion-safety rule shared by `list` and `remove`.
 * A worktree is treated as "changed" if it has tracked modifications, untracked files, or commits
 * ahead of its comparison ref (upstream when available, otherwise `origin/main`). Detached
 * worktrees are always treated as needing confirmation because they can contain unpublished commits
 * without a stable comparison ref.
 */
export function hasChanges(status: WorktreeStatus): boolean {
  return status.worktree.detached || status.dirty || status.untracked || status.localCommits > 0;
}

function printDryRunPlan(
  repoRoot: string,
  target: CreationTarget,
  runSetup: boolean,
): WorktreeOperation<void, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const setupExists = runSetup && (yield* fs.exists(path.join(repoRoot, "setup-worktree.sh")));
    yield* Console.log("Dry run only. No changes were made.");
    yield* Console.log(`Resolved path: ${formatDisplayPath(repoRoot, target.worktreePath)}`);
    yield* Console.log(`Source: ${target.displaySource}`);
    yield* Console.log(`Git command: git ${target.createArgs.join(" ")}`);
    yield* Console.log(`Run setup-worktree.sh: ${setupExists ? "yes" : "no"}`);
  });
}

function confirmDestructiveAction(question: string): WorktreeOperation<boolean, Terminal.Terminal> {
  return Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    if (!(yield* stdio.stdinIsTerminal) || !(yield* stdio.stdoutIsTerminal)) {
      return yield* Effect.fail(
        new Error("Confirmation is required, but no interactive terminal is available."),
      );
    }
    const terminal = yield* Terminal.Terminal;
    yield* terminal.display(question);
    // Keep the explicit y/yes contract rather than switching to a single-key confirmation.
    return isConfirmedAnswer(yield* terminal.readLine);
  });
}

export function isConfirmedAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export function formatDisplayPath(repoRoot: string, worktreePath: string): string {
  const relativePath = path.relative(repoRoot, worktreePath);
  return relativePath === "" || relativePath.startsWith("..") ? worktreePath : relativePath;
}

export function getWorktreePathKind(
  repoRoot: string,
  worktree: Pick<WorktreeRecord, "path" | "branchName" | "detached">,
): "default" | "custom" {
  if (worktree.branchName) {
    return areSamePath(
      worktree.path,
      resolveCreateWorktreePath(
        repoRoot,
        getDefaultBranchWorktreeRelativePath(repoRoot, worktree.branchName),
        null,
      ),
    )
      ? "default"
      : "custom";
  }

  const repoParent = path.dirname(path.resolve(repoRoot));
  const repoName = path.basename(path.resolve(repoRoot));
  const worktreeParent = path.dirname(path.resolve(worktree.path));
  const worktreeBaseName = path.basename(path.resolve(worktree.path));

  return worktree.detached &&
    areSamePath(worktreeParent, repoParent) &&
    worktreeBaseName.startsWith(`${repoName}-detached-`)
    ? "default"
    : "custom";
}

export function toYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function areSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function runCommand(
  executable: string,
  args: readonly string[],
  options: RunOptions = {},
): WorktreeOperation<RunResult> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const stdio = yield* Stdio.Stdio;
    const start = performance.now();
    yield* logEvent("subprocess_started");
    const result = yield* Effect.gen(function* () {
      const inherited = options.stdio === "inherit";
      const child = yield* spawner.spawn(
        ChildProcess.make(executable, args, {
          cwd: options.cwd,
          stdin: inherited ? "inherit" : "ignore",
          stdout: inherited ? "inherit" : "pipe",
          stderr: "pipe",
        }),
      );
      const [stdout, stderr] = yield* Effect.all(
        [
          inherited
            ? Effect.succeed("")
            : Stream.runFold(
                Stream.decodeText(child.stdout),
                () => "",
                (text, chunk) => text + chunk,
              ),
          child.stderr.pipe(
            Stream.tap((chunk) =>
              Stream.run(Stream.make(chunk), stdio.stderr({ endOnDone: false })),
            ),
            Stream.decodeText(),
            Stream.tap((chunk) => logEvent("subprocess_stderr", { stderr: chunk })),
            Stream.runFold(
              () => "",
              (text, chunk) => text + chunk,
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const status = yield* child.exitCode;
      return { stdout, stderr, status };
    }).pipe(
      Effect.scoped,
      Effect.onExit((exit) =>
        logEvent("subprocess_finished", {
          duration_ms: Math.round(performance.now() - start),
          ...(Exit.isSuccess(exit)
            ? {
                exit_code: exit.value.status,
                outcome: exit.value.status === 0 ? "success" : "failure",
              }
            : Exit.hasInterrupts(exit)
              ? { outcome: "cancelled" }
              : { outcome: "failure", error: Cause.pretty(exit.cause) }),
        }),
      ),
    );
    if (result.status !== 0 && !options.allowFailure) {
      const message =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `Command failed with exit code ${result.status}.`;
      return yield* Effect.fail(new Error(`${[executable, ...args].join(" ")}: ${message}`));
    }
    return result;
  }).pipe(
    Effect.annotateLogs({
      executable,
      args,
      cwd: options.cwd ?? process.cwd(),
      allow_failure: options.allowFailure === true,
    }),
  );
}

function optionalValue(name: string, description: string): Flag.Flag<string | null> {
  return Flag.String(name).pipe(
    Flag.filter(
      (value) => value.length > 0,
      () => `Option "--${name}" requires a value.`,
    ),
    Flag.withDescription(description),
    Flag.withDefault(null),
  );
}

function requiredArgument(name: string): Argument.Argument<string> {
  return Argument.String(name).pipe(
    Argument.filter(
      (value) => value.length > 0,
      () => `${name} must not be empty.`,
    ),
  );
}

const parent = Command.make("mb-worktree", {}, () =>
  Effect.fail(new Error("Specify a worktree command. See --help.")),
).pipe(
  Command.withDescription("Create, inspect, and safely remove repo-local Git worktrees."),
  // Shared flags preserve the existing before/after-subcommand option placement.
  Command.withSharedFlags({
    repo: optionalValue(
      "repo",
      "Target a repo; relative paths resolve from AI_CWD or the caller's cwd.",
    ),
    path: optionalValue("path", "Override the target worktree directory for create commands."),
    from: optionalValue("from", "Base ref for new-branch."),
    runSetup: Flag.Boolean("no-setup").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Skip setup-worktree.sh after creating a worktree."),
      Flag.map((skip) => !skip),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print actions without changing anything."),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Emit machine-readable list output."),
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Skip removal confirmation and force deletion."),
    ),
    deleteBranch: Flag.Boolean("delete-branch").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Delete the branch only after successful worktree removal."),
    ),
  }),
);

export const command = parent.pipe(
  Command.withSubcommands([
    Command.make("list", {}, () =>
      Effect.gen(function* () {
        const options = yield* parent;
        const context = yield* buildContext(options.repo);
        yield* runList(context, options.json).pipe(Effect.annotateLogs({ action: "list" }));
      }),
    ).pipe(Command.withDescription("List linked worktrees and their local status.")),
    Command.make("checkout", { ref: requiredArgument("ref") }, ({ ref }) =>
      Effect.gen(function* () {
        const options = yield* parent;
        const context = yield* buildContext(options.repo);
        yield* runCheckout(context, ref, options.runSetup, options.path, options.dryRun).pipe(
          Effect.annotateLogs({ action: "checkout", ref }),
        );
      }),
    ).pipe(
      Command.withDescription(
        "Create a worktree from an existing branch, remote branch, tag, or commit.",
      ),
    ),
    Command.make("new-branch", { branch: requiredArgument("branch") }, ({ branch }) =>
      Effect.gen(function* () {
        const options = yield* parent;
        const context = yield* buildContext(options.repo);
        yield* runNewBranch(
          context,
          branch,
          options.from,
          options.runSetup,
          options.path,
          options.dryRun,
        ).pipe(Effect.annotateLogs({ action: "new-branch", branch, from: options.from }));
      }),
    ).pipe(Command.withDescription("Create a new branch worktree from --from <ref>.")),
    Command.make("new-from-main", { branch: requiredArgument("branch") }, ({ branch }) =>
      Effect.gen(function* () {
        const options = yield* parent;
        const context = yield* buildContext(options.repo);
        yield* runNewFromMain(context, branch, options.runSetup, options.path, options.dryRun).pipe(
          Effect.annotateLogs({ action: "new-from-main", branch }),
        );
      }),
    ).pipe(
      Command.withDescription("Fetch origin/main, create a new branch worktree, and run setup."),
    ),
    Command.make("new-from-pr", { pr: requiredArgument("url-or-number") }, ({ pr }) =>
      Effect.gen(function* () {
        const options = yield* parent;
        const context = yield* buildContext(options.repo);
        yield* runNewFromPr(context, pr, options.runSetup, options.path, options.dryRun).pipe(
          Effect.annotateLogs({ action: "new-from-pr", pr }),
        );
      }),
    ).pipe(Command.withDescription("Fetch a same-repo PR head and create its worktree.")),
    Command.make("remove", { target: requiredArgument("branch-or-path") }, ({ target }) =>
      Effect.gen(function* () {
        const options = yield* parent;
        const context = yield* buildContext(options.repo);
        yield* runRemove(context, target, options.deleteBranch, options.force, options.dryRun).pipe(
          Effect.annotateLogs({ action: "remove", target }),
        );
      }),
    ).pipe(
      Command.withDescription(
        "Remove a worktree, confirming changes or unpublished commits unless --force is set.",
      ),
    ),
  ]),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    withExecutionLog("mb-worktree", command.pipe(Command.run({ version: "0.0.0" }))).pipe(
      Effect.tapCause((cause) => {
        const error = Cause.squash(cause);
        return error instanceof CliError.ShowHelp || Cause.hasInterrupts(cause)
          ? Effect.void
          : Console.error(getErrorMessage(error));
      }),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
