#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';

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
 */
type CommandName = 'list' | 'checkout' | 'new-branch' | 'new-from-main' | 'new-from-pr' | 'remove';

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

interface ParsedArgs {
  readonly command: CommandName | null;
  readonly positional: string[];
  readonly deleteBranch: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly runSetup: boolean;
  readonly fromRef: string | null;
  readonly help: boolean;
  readonly json: boolean;
  readonly pathOverride: string | null;
}

interface RunOptions {
  readonly cwd?: string;
  readonly stdio?: 'inherit' | 'pipe';
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

type CreateCollisionDecision =
  | {
      readonly kind: 'reuse-existing';
      readonly existingWorktree: WorktreeRecord;
    }
  | {
      readonly kind: 'path-conflict';
      readonly existingWorktree: WorktreeRecord;
    }
  | {
      readonly kind: 'branch-conflict';
      readonly existingWorktree: WorktreeRecord;
    }
  | {
      readonly kind: 'create-new';
    };

type CreationTarget =
  | {
      readonly kind: 'branch';
      readonly worktreePath: string;
      readonly branchName: string;
      readonly createArgs: readonly string[];
      readonly displaySource: string;
    }
  | {
      readonly kind: 'detached';
      readonly worktreePath: string;
      readonly resolvedCommit: string;
      readonly requestedRef: string;
      readonly createArgs: readonly string[];
      readonly displaySource: string;
    };

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help || parsed.command === null) {
    printUsage();
    process.exit(parsed.help ? 0 : 1);
  }

  const context = buildContext();

  switch (parsed.command) {
    case 'list':
      ensureNoExtraArgs(parsed.positional, 'list');
      runList(context, parsed.json);
      return;
    case 'checkout':
      runCheckout(context, parsed.positional, parsed.runSetup, parsed.pathOverride, parsed.dryRun);
      return;
    case 'new-branch':
      runNewBranch(
        context,
        parsed.positional,
        parsed.fromRef,
        parsed.runSetup,
        parsed.pathOverride,
        parsed.dryRun,
      );
      return;
    case 'new-from-main':
      runNewFromMain(
        context,
        parsed.positional,
        parsed.runSetup,
        parsed.pathOverride,
        parsed.dryRun,
      );
      return;
    case 'new-from-pr':
      runNewFromPr(context, parsed.positional, parsed.runSetup, parsed.pathOverride, parsed.dryRun);
      return;
    case 'remove':
      await runRemove(context, parsed.positional, parsed.deleteBranch, parsed.force, parsed.dryRun);
      return;
    default:
      assertNever(parsed.command);
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  let deleteBranch = false;
  let dryRun = false;
  let force = false;
  let runSetup = true;
  let fromRef: string | null = null;
  let help = false;
  let json = false;
  let pathOverride: string | null = null;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--delete-branch':
        deleteBranch = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--force':
        force = true;
        break;
      case '--no-setup':
        runSetup = false;
        break;
      case '--from': {
        const value = args[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error('Option "--from" requires a ref value.');
        }
        fromRef = value;
        index += 1;
        break;
      }
      case '--path': {
        const value = args[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error('Option "--path" requires a directory value.');
        }
        pathOverride = value;
        index += 1;
        break;
      }
      case '--json':
        json = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        if (arg.startsWith('--from=')) {
          fromRef = arg.slice('--from='.length);
          if (fromRef.length === 0) {
            throw new Error('Option "--from" requires a ref value.');
          }
          break;
        }

        if (arg.startsWith('--path=')) {
          pathOverride = arg.slice('--path='.length);
          if (pathOverride.length === 0) {
            throw new Error('Option "--path" requires a directory value.');
          }
          break;
        }

        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }

        positional.push(arg);
        break;
    }
  }

  const commandCandidate = positional[0] ?? null;
  const command = isCommandName(commandCandidate) ? commandCandidate : null;

  return {
    command,
    positional: command === null ? positional : positional.slice(1),
    deleteBranch,
    dryRun,
    force,
    runSetup,
    fromRef,
    help,
    json,
    pathOverride,
  };
}

function isCommandName(value: string | null): value is CommandName {
  return (
    value === 'list' ||
    value === 'checkout' ||
    value === 'new-branch' ||
    value === 'new-from-main' ||
    value === 'new-from-pr' ||
    value === 'remove'
  );
}

function printUsage(): void {
  process.stdout.write(`Usage:
  ./scripts/worktree.ts list
  ./scripts/worktree.ts checkout <ref>
  ./scripts/worktree.ts new-branch <branch> --from <ref>
  ./scripts/worktree.ts new-from-main <branch>
  ./scripts/worktree.ts new-from-pr <url-or-number>
  ./scripts/worktree.ts remove <branch-or-path> [--delete-branch] [--force]

Commands:
  list                      List linked worktrees and their local status.
  checkout <ref>            Create a worktree from an existing branch, remote branch, tag, or commit.
  new-branch <branch>       Create a new branch worktree from the explicit --from ref.
  new-from-main <branch>    Fetch origin/main, create a new branch worktree, then run setup-worktree.sh when present.
  new-from-pr <url|number>  Fetch a same-repo PR head and create its worktree when no same-named local branch exists.
  remove <branch-or-path>   Remove a worktree. Prompts if it has file changes, untracked files, or local commits unless --force is set.

Options:
  --from <ref>              Base ref for new-branch.
  --json                    Emit machine-readable JSON output for list.
  --path <dir>              Override the target worktree directory for create commands.
  --delete-branch           After successful removal, also delete the local branch with git branch -d/-D.
  --dry-run                 Print the resolved actions without creating or removing anything.
  --force                   Skip remove confirmation and use forceful branch/worktree deletion where applicable.
  --no-setup                Skip setup-worktree.sh after creating a new worktree.
  -h, --help                Show this help message.
`);
}

function ensureNoExtraArgs(args: readonly string[], command: CommandName): void {
  if (args.length > 0) {
    throw new Error(`Command "${command}" does not accept extra arguments.`);
  }
}

function buildContext(): CommandContext {
  const primaryWorktreeRoot = resolvePrimaryWorktreeRoot(process.cwd());
  const currentWorktreeRoot = resolveGitTopLevel(process.cwd());
  const repoRoot = primaryWorktreeRoot;
  const repoIdentity = resolveRepoIdentity(repoRoot);

  return {
    repoRoot,
    primaryWorktreeRoot,
    currentWorktreeRoot,
    repoIdentity,
  };
}

function resolveGitTopLevel(cwd: string): string {
  const result = runCommand('git', ['rev-parse', '--show-toplevel'], { cwd });
  return result.stdout.trim();
}

function resolvePrimaryWorktreeRoot(cwd: string): string {
  const result = runCommand('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
  });
  const gitCommonDir = result.stdout.trim();

  if (path.basename(gitCommonDir) !== '.git') {
    throw new Error(`Expected git common dir to end with .git, got: ${gitCommonDir}`);
  }

  return path.dirname(gitCommonDir);
}

function resolveRepoIdentity(repoRoot: string): RepoIdentity {
  const remoteUrl = runCommand('git', ['remote', 'get-url', 'origin'], {
    cwd: repoRoot,
  }).stdout.trim();
  const normalizedUrl = remoteUrl.replace(/\.git$/, '');

  const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/](.+)\/(.+)$/.exec(normalizedUrl);
  if (sshMatch) {
    const owner = sshMatch[1];
    const name = sshMatch[2];
    return { owner, name, nameWithOwner: `${owner}/${name}` };
  }

  const httpsMatch = /^https:\/\/github\.com\/(.+)\/(.+)$/.exec(normalizedUrl);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const name = httpsMatch[2];
    return { owner, name, nameWithOwner: `${owner}/${name}` };
  }

  throw new Error(`Unsupported GitHub origin URL: ${remoteUrl}`);
}

interface WorktreeListRow {
  readonly branch: string;
  readonly source: 'branch' | 'detached';
  readonly pathKind: 'default' | 'custom';
  readonly upstream: string;
  readonly comparison: string;
  readonly path: string;
  readonly dirty: string;
  readonly untracked: string;
  readonly localCommits: string;
  readonly current: string;
  readonly primary: string;
}

function runList(context: CommandContext, json: boolean): void {
  const statuses = collectWorktreeStatuses(context);

  if (statuses.length === 0) {
    process.stdout.write(json ? '[]\n' : 'No worktrees found.\n');
    return;
  }

  const rows = buildWorktreeListRows(context.repoRoot, statuses);
  if (json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  const headers: (keyof WorktreeListRow)[] = [
    'branch',
    'source',
    'pathKind',
    'upstream',
    'comparison',
    'path',
    'dirty',
    'untracked',
    'localCommits',
    'current',
    'primary',
  ];

  const widths = headers.map(header =>
    Math.max(header.length, ...rows.map(row => row[header].length)),
  );

  const headerLine = headers
    .map((header, index) => header.padEnd(widths[index] ?? header.length))
    .join('  ');
  const separatorLine = widths.map(width => '-'.repeat(width)).join('  ');

  process.stdout.write(`${headerLine}\n${separatorLine}\n`);
  for (const row of rows) {
    const line = headers
      .map((header, index) => row[header].padEnd(widths[index] ?? header.length))
      .join('  ');
    process.stdout.write(`${line}\n`);
  }
}

function runCheckout(
  context: CommandContext,
  args: readonly string[],
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): void {
  const requestedRef = args[0];
  if (!requestedRef || args.length !== 1) {
    throw new Error('Command "checkout" requires exactly one ref.');
  }

  const target = resolveCheckoutTarget(context, requestedRef, pathOverride);
  createOrReuseWorktree(context, target, runSetup, dryRun);
}

function runNewBranch(
  context: CommandContext,
  args: readonly string[],
  fromRef: string | null,
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): void {
  const branchName = args[0];
  if (!branchName || args.length !== 1) {
    throw new Error('Command "new-branch" requires exactly one new branch name.');
  }

  if (!fromRef) {
    throw new Error('Command "new-branch" requires "--from <ref>".');
  }

  const target = buildNewBranchTarget(context, branchName, fromRef, pathOverride);
  createOrReuseWorktree(context, target, runSetup, dryRun);
}

function runNewFromMain(
  context: CommandContext,
  args: readonly string[],
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): void {
  const branchName = args[0];
  if (!branchName || args.length !== 1) {
    throw new Error('Command "new-from-main" requires exactly one new branch name.');
  }

  if (dryRun) {
    process.stdout.write('Dry run only. Skipping fetch for origin/main.\n');
  } else {
    process.stdout.write('Fetching origin/main...\n');
    runCommand('git', ['fetch', 'origin', 'main'], {
      cwd: context.repoRoot,
      stdio: 'inherit',
    });
  }

  const target = buildNewBranchTarget(context, branchName, 'origin/main', pathOverride);
  createOrReuseWorktree(context, target, runSetup, dryRun);
}

function runNewFromPr(
  context: CommandContext,
  args: readonly string[],
  runSetup: boolean,
  pathOverride: string | null,
  dryRun: boolean,
): void {
  const prSelector = args[0];
  if (!prSelector || args.length !== 1) {
    throw new Error('Command "new-from-pr" requires exactly one PR URL or number.');
  }

  const metadata = resolvePullRequestMetadata(context, prSelector);

  if (metadata.isCrossRepository) {
    throw new Error(
      `PR #${metadata.number} comes from a fork/cross-repo branch; only same-repo PRs are supported.`,
    );
  }

  const headRepository = metadata.headRepository;
  if (headRepository?.nameWithOwner !== context.repoIdentity.nameWithOwner) {
    throw new Error(
      `PR #${metadata.number} head repository does not match ${context.repoIdentity.nameWithOwner}.`,
    );
  }

  if (dryRun) {
    process.stdout.write(`Dry run only. Skipping fetch for origin/${metadata.headRefName}.\n`);
  } else {
    process.stdout.write(`Fetching origin/${metadata.headRefName}...\n`);
    runCommand('git', ['fetch', 'origin', metadata.headRefName], {
      cwd: context.repoRoot,
      stdio: 'inherit',
    });
  }

  const existingLocalHeadBranch = resolveExistingLocalBranch(
    context.repoRoot,
    metadata.headRefName,
  );
  if (existingLocalHeadBranch) {
    throw new Error(
      formatExistingLocalBranchConflict(
        existingLocalHeadBranch,
        `fetched PR head origin/${metadata.headRefName}`,
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
  createOrReuseWorktree(context, target, runSetup, dryRun);
}

function resolvePullRequestMetadata(
  context: CommandContext,
  prSelector: string,
): PullRequestMetadata {
  const json = runCommand(
    'gh',
    [
      'pr',
      'view',
      prSelector,
      '--json',
      'number,headRefName,isCrossRepository,headRepository,headRepositoryOwner',
    ],
    {
      cwd: context.repoRoot,
    },
  ).stdout;

  const parsed = JSON.parse(json) as {
    number: number;
    headRefName: string;
    isCrossRepository: boolean;
    headRepository: {
      name: string;
      nameWithOwner: string;
      owner?: { login?: string | null } | null;
    } | null;
    headRepositoryOwner?: { login?: string | null } | null;
  };

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
            context.repoIdentity.owner,
        }
      : null,
  };
}

export function resolvePrHeadSource(headRefName: string): string {
  return `origin/${headRefName}`;
}

export function isExplicitRemoteBranchRequest(
  requestedRef: string,
  remoteBranch: Pick<RemoteBranchResolution, 'remoteRef'> | null,
): boolean {
  return remoteBranch !== null && requestedRef === remoteBranch.remoteRef;
}

function resolveCheckoutTarget(
  context: CommandContext,
  requestedRef: string,
  pathOverride: string | null,
): CreationTarget {
  const remoteBranch = resolveRemoteBranch(context.repoRoot, requestedRef);
  if (remoteBranch && isExplicitRemoteBranchRequest(requestedRef, remoteBranch)) {
    const existingLocalBranch = resolveExistingLocalBranch(
      context.repoRoot,
      remoteBranch.localBranchName,
    );
    if (existingLocalBranch) {
      throw new Error(
        formatExistingLocalBranchConflict(
          existingLocalBranch,
          `remote ref ${remoteBranch.remoteRef}`,
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

  const localBranch = resolveExistingLocalBranch(context.repoRoot, requestedRef);
  if (localBranch) {
    return buildBranchTarget(context, localBranch, localBranch, false, pathOverride);
  }

  if (remoteBranch) {
    const localBranchFromRemote = resolveExistingLocalBranch(
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

  if (refExists(context.repoRoot, `refs/tags/${requestedRef}`)) {
    const resolvedCommit = resolveCommitish(context.repoRoot, requestedRef);
    return buildDetachedTarget(context, requestedRef, resolvedCommit, pathOverride);
  }

  const resolvedCommit = tryResolveCommitish(context.repoRoot, requestedRef);
  if (resolvedCommit) {
    return buildDetachedTarget(context, requestedRef, resolvedCommit, pathOverride);
  }

  throw new Error(`Could not resolve ref: ${requestedRef}`);
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
    ? ['worktree', 'add', '-b', branchName, worktreePath, sourceRef]
    : ['worktree', 'add', worktreePath, branchName];

  const actualCreateArgs =
    !createNewBranch && sourceRef !== branchName
      ? ['worktree', 'add', '-b', branchName, worktreePath, sourceRef]
      : createArgs;

  return {
    kind: 'branch',
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
    kind: 'detached',
    worktreePath,
    resolvedCommit,
    requestedRef,
    createArgs: ['worktree', 'add', '--detach', worktreePath, resolvedCommit],
    displaySource: requestedRef,
  };
}

function createOrReuseWorktree(
  context: CommandContext,
  target: CreationTarget,
  runSetup: boolean,
  dryRun: boolean,
): void {
  const existingWorktrees = listWorktrees(context.repoRoot);
  const collisionDecision = evaluateCreateCollision(existingWorktrees, target);

  if (collisionDecision.kind === 'reuse-existing') {
    process.stdout.write(
      `already exists: ${formatDisplayPath(context.repoRoot, collisionDecision.existingWorktree.path)}\n`,
    );
    return;
  }

  if (collisionDecision.kind === 'path-conflict') {
    throw new Error(
      `Target path already belongs to a different worktree: ${formatDisplayPath(
        context.repoRoot,
        collisionDecision.existingWorktree.path,
      )}`,
    );
  }

  if (collisionDecision.kind === 'branch-conflict') {
    throw new Error(
      `Branch "${target.kind === 'branch' ? target.branchName : '(detached)'}" is already checked out in ${formatDisplayPath(
        context.repoRoot,
        collisionDecision.existingWorktree.path,
      )}.`,
    );
  }

  if (fs.existsSync(target.worktreePath)) {
    throw new Error(
      `Target path exists but is not a registered worktree: ${formatDisplayPath(
        context.repoRoot,
        target.worktreePath,
      )}. Remove it or choose a different target.`,
    );
  }

  if (dryRun) {
    printDryRunPlan(context.repoRoot, target, runSetup);
    return;
  }

  fs.mkdirSync(path.dirname(target.worktreePath), { recursive: true });

  process.stdout.write(
    `Creating worktree at ${formatDisplayPath(context.repoRoot, target.worktreePath)} from ${target.displaySource}...\n`,
  );
  runCommand('git', target.createArgs, {
    cwd: context.repoRoot,
    stdio: 'inherit',
  });

  runSetupWorktreeHookIfPresent(context.repoRoot, target.worktreePath, runSetup);
}

export function evaluateCreateCollision(
  existingWorktrees: readonly WorktreeRecord[],
  target: CreationTarget,
): CreateCollisionDecision {
  const existingByPath = existingWorktrees.find(worktree =>
    areSamePath(worktree.path, target.worktreePath),
  );

  if (existingByPath) {
    if (isReusableExistingWorktree(existingByPath, target)) {
      return {
        kind: 'reuse-existing',
        existingWorktree: existingByPath,
      };
    }

    return {
      kind: 'path-conflict',
      existingWorktree: existingByPath,
    };
  }

  if (target.kind === 'branch') {
    const existingBranchWorktree = existingWorktrees.find(
      worktree =>
        worktree.branchName === target.branchName &&
        !areSamePath(worktree.path, target.worktreePath),
    );

    if (existingBranchWorktree) {
      return {
        kind: 'branch-conflict',
        existingWorktree: existingBranchWorktree,
      };
    }
  }

  return {
    kind: 'create-new',
  };
}

export function isReusableExistingWorktree(
  existingWorktree: WorktreeRecord,
  target: CreationTarget,
): boolean {
  if (target.kind === 'branch') {
    return existingWorktree.branchName === target.branchName;
  }

  return existingWorktree.detached && existingWorktree.head === target.resolvedCommit;
}

function resolveExistingLocalBranch(repoRoot: string, branchName: string): string | null {
  return refExists(repoRoot, `refs/heads/${branchName}`) ? branchName : null;
}

function resolveRemoteBranch(
  repoRoot: string,
  requestedRef: string,
): RemoteBranchResolution | null {
  const remoteRefs = listRemoteTrackingRefs(repoRoot);
  return resolveRemoteBranchFromRefs(remoteRefs, requestedRef);
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
    remoteRef => deriveLocalBranchNameFromRemoteRef(remoteRef) === requestedRef,
  );
  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new Error(
      `Ref "${requestedRef}" matches multiple remote branches: ${matches.join(', ')}. Use an explicit remote ref.`,
    );
  }

  return {
    remoteRef: matches[0],
    localBranchName: deriveLocalBranchNameFromRemoteRef(matches[0]),
  };
}

function deriveLocalBranchNameFromRemoteRef(remoteRef: string): string {
  const separatorIndex = remoteRef.indexOf('/');
  if (separatorIndex === -1 || separatorIndex === remoteRef.length - 1) {
    throw new Error(`Expected remote ref in "<remote>/<branch>" form, got: ${remoteRef}`);
  }

  return remoteRef.slice(separatorIndex + 1);
}

function listRemoteTrackingRefs(repoRoot: string): string[] {
  const output = runCommand(
    'git',
    ['for-each-ref', '--format=%(refname:strip=2)', 'refs/remotes'],
    { cwd: repoRoot },
  ).stdout;

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.endsWith('/HEAD'));
}

function refExists(repoRoot: string, ref: string): boolean {
  return (
    runCommand('git', ['show-ref', '--verify', '--quiet', ref], {
      cwd: repoRoot,
      allowFailure: true,
    }).status === 0
  );
}

function resolveCommitish(repoRoot: string, ref: string): string {
  const resolved = tryResolveCommitish(repoRoot, ref);
  if (!resolved) {
    throw new Error(`Could not resolve commit-ish: ${ref}`);
  }

  return resolved;
}

function tryResolveCommitish(repoRoot: string, ref: string): string | null {
  const result = runCommand('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    allowFailure: true,
  });

  return result.status === 0 ? result.stdout.trim() : null;
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
  return path.join('..', `${path.basename(repoRoot)}-${branchName}`);
}

function getDefaultDetachedWorktreeRelativePath(repoRoot: string, requestedRef: string): string {
  return path.join('..', `${path.basename(repoRoot)}-detached-${sanitizePathToken(requestedRef)}`);
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
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'ref';
}

async function runRemove(
  context: CommandContext,
  args: readonly string[],
  deleteBranch: boolean,
  force: boolean,
  dryRun: boolean,
): Promise<void> {
  const targetArg = args[0];
  if (!targetArg || args.length !== 1) {
    throw new Error('Command "remove" requires exactly one branch name or path.');
  }

  const statuses = collectWorktreeStatuses(context);
  const target = resolveRemovalTarget(statuses, context.repoRoot, targetArg);

  if (target.isCurrent) {
    throw new Error(`Refusing to remove the current worktree: ${target.worktree.path}`);
  }

  if (target.isPrimary) {
    throw new Error(`Refusing to remove the primary repository checkout: ${target.worktree.path}`);
  }

  const dirtyRemovalConfirmed = force
    ? hasChanges(target)
    : dryRun
      ? hasChanges(target)
      : hasChanges(target)
        ? await confirmDirtyRemoval(context.repoRoot, target)
        : false;
  if (!dryRun && hasChanges(target) && !dirtyRemovalConfirmed) {
    return;
  }

  if (dryRun) {
    process.stdout.write('Dry run only. No changes were made.\n');
    process.stdout.write(
      `Would remove: ${formatDisplayPath(context.repoRoot, target.worktree.path)}\n`,
    );
    process.stdout.write(`Force remove: ${toYesNo(dirtyRemovalConfirmed)}\n`);
    process.stdout.write(
      `Delete branch: ${deleteBranch && target.worktree.branchName ? target.worktree.branchName : 'no'}\n`,
    );
    return;
  }

  process.stdout.write(
    `Removing worktree ${formatDisplayPath(context.repoRoot, target.worktree.path)}...\n`,
  );
  const removeArgs = dirtyRemovalConfirmed
    ? ['worktree', 'remove', '--force', target.worktree.path]
    : ['worktree', 'remove', target.worktree.path];
  runCommand('git', removeArgs, {
    cwd: context.repoRoot,
    stdio: 'inherit',
  });

  if (deleteBranch && target.worktree.branchName) {
    process.stdout.write(`Deleting branch ${target.worktree.branchName}...\n`);
    const deleteBranchFlag = getBranchDeletionFlag(target, force);
    runCommand('git', ['branch', deleteBranchFlag, target.worktree.branchName], {
      cwd: context.repoRoot,
      stdio: 'inherit',
    });
  }
}

export function getBranchDeletionFlag(
  status: WorktreeStatus,
  force: boolean,
): '-d' | '-D' {
  return force || status.localCommits > 0 ? '-D' : '-d';
}

async function confirmDirtyRemoval(repoRoot: string, status: WorktreeStatus): Promise<boolean> {
  if (!hasChanges(status)) {
    return false;
  }

  const details = [
    status.worktree.detached ? 'detached HEAD (commits may be unpublished)' : null,
    status.dirty ? 'tracked changes' : null,
    status.untracked ? 'untracked files' : null,
    status.localCommits > 0 ? `${status.localCommits} local commit(s)` : null,
  ].filter(isPresent);

  const confirmed = await confirmDestructiveAction(
    `Worktree ${formatDisplayPath(repoRoot, status.worktree.path)} has ${details.join(', ')}. Remove it? [y/N] `,
  );
  if (!confirmed) {
    process.stdout.write('Removal cancelled.\n');
    return false;
  }

  return true;
}

function runSetupWorktreeHookIfPresent(
  repoRoot: string,
  worktreePath: string,
  runSetup: boolean,
): void {
  const setupScriptPath = path.join(repoRoot, 'setup-worktree.sh');

  if (!fs.existsSync(setupScriptPath)) {
    process.stdout.write('No setup-worktree.sh found. Skipping post-create setup.\n');
    return;
  }

  if (!runSetup) {
    process.stdout.write('Skipped setup-worktree.sh because --no-setup was provided.\n');
    return;
  }

  process.stdout.write('Running setup-worktree.sh...\n');
  runCommand('bash', ['./setup-worktree.sh', worktreePath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

export function buildWorktreeListRows(
  repoRoot: string,
  statuses: readonly WorktreeStatus[],
): WorktreeListRow[] {
  return statuses.map(status => ({
    branch: status.worktree.branchName ?? '(detached)',
    source: status.worktree.detached ? 'detached' : 'branch',
    pathKind: getWorktreePathKind(repoRoot, status.worktree),
    upstream: status.upstreamRef ?? '(none)',
    comparison: status.comparisonRef,
    path: formatDisplayPath(repoRoot, status.worktree.path),
    dirty: toYesNo(status.dirty),
    untracked: toYesNo(status.untracked),
    localCommits: status.worktree.detached ? 'n/a' : String(status.localCommits),
    current: toYesNo(status.isCurrent),
    primary: toYesNo(status.isPrimary),
  }));
}

function collectWorktreeStatuses(context: CommandContext): WorktreeStatus[] {
  return listWorktrees(context.repoRoot).map(worktree => {
    const statusOutput = runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: worktree.path,
    }).stdout;

    const statusLines = statusOutput
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean);

    const dirty = statusLines.some(line => !line.startsWith('??'));
    const untracked = statusLines.some(line => line.startsWith('??'));
    const upstreamRef = getUpstreamRef(worktree);
    const comparisonRef = getComparisonRef(worktree, upstreamRef);
    const localCommits = getLocalCommitCount(worktree.path, comparisonRef, worktree.detached);

    return {
      worktree,
      isCurrent: areSamePath(worktree.path, context.currentWorktreeRoot),
      isPrimary: areSamePath(worktree.path, context.primaryWorktreeRoot),
      dirty,
      untracked,
      localCommits,
      upstreamRef,
      comparisonRef,
    };
  });
}

function listWorktrees(repoRoot: string): WorktreeRecord[] {
  const output = runCommand('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
  }).stdout;

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
      branchName: branchRef ? branchRef.replace(/^refs\/heads\//, '') : null,
      detached,
    });

    currentPath = null;
    head = null;
    branchRef = null;
    detached = false;
  };

  for (const line of output.split('\n')) {
    if (line === '') {
      flush();
      continue;
    }

    if (line.startsWith('worktree ')) {
      flush();
      currentPath = line.slice('worktree '.length);
      continue;
    }

    if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length);
      continue;
    }

    if (line.startsWith('branch ')) {
      branchRef = line.slice('branch '.length);
      continue;
    }

    if (line === 'detached') {
      detached = true;
    }
  }

  flush();
  return records;
}

export function getUpstreamRef(worktree: Pick<WorktreeRecord, 'path' | 'detached'>): string | null {
  if (worktree.detached) {
    return null;
  }

  const upstream = runCommand(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
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
}

export function getComparisonRef(
  worktree: Pick<WorktreeRecord, 'path' | 'detached'>,
  upstreamRef: string | null = getUpstreamRef(worktree),
): string {
  if (worktree.detached) {
    return 'HEAD';
  }

  return upstreamRef ?? 'origin/main';
}

function getLocalCommitCount(
  worktreePath: string,
  comparisonRef: string,
  detached: boolean,
): number {
  if (detached || comparisonRef === 'HEAD') {
    return 0;
  }

  const result = runCommand('git', ['rev-list', '--count', `${comparisonRef}..HEAD`], {
    cwd: worktreePath,
    allowFailure: true,
  });

  if (result.status !== 0) {
    return 0;
  }

  const parsed = Number(result.stdout.trim());
  return Number.isFinite(parsed) ? parsed : 0;
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
  const byBranch = statuses.find(status => status.worktree.branchName === targetArg);
  if (byBranch) {
    return byBranch;
  }

  const absoluteTargetPath = path.isAbsolute(targetArg)
    ? path.resolve(targetArg)
    : path.resolve(repoRoot, targetArg);

  const byPath = statuses.find(status => areSamePath(status.worktree.path, absoluteTargetPath));
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

function printDryRunPlan(repoRoot: string, target: CreationTarget, runSetup: boolean): void {
  process.stdout.write('Dry run only. No changes were made.\n');
  process.stdout.write(`Resolved path: ${formatDisplayPath(repoRoot, target.worktreePath)}\n`);
  process.stdout.write(`Source: ${target.displaySource}\n`);
  process.stdout.write(`Git command: git ${target.createArgs.join(' ')}\n`);
  process.stdout.write(
    `Run setup-worktree.sh: ${runSetup && fs.existsSync(path.join(repoRoot, 'setup-worktree.sh')) ? 'yes' : 'no'}\n`,
  );
}

async function confirmDestructiveAction(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Confirmation is required, but no interactive terminal is available.');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(question);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

export function formatDisplayPath(repoRoot: string, worktreePath: string): string {
  const relativePath = path.relative(repoRoot, worktreePath);
  return relativePath === '' || relativePath.startsWith('..') ? worktreePath : relativePath;
}

export function getWorktreePathKind(
  repoRoot: string,
  worktree: Pick<WorktreeRecord, 'path' | 'branchName' | 'detached'>,
): 'default' | 'custom' {
  if (worktree.branchName) {
    return areSamePath(
      worktree.path,
      resolveCreateWorktreePath(
        repoRoot,
        getDefaultBranchWorktreeRelativePath(repoRoot, worktree.branchName),
        null,
      ),
    )
      ? 'default'
      : 'custom';
  }

  const repoParent = path.dirname(path.resolve(repoRoot));
  const repoName = path.basename(path.resolve(repoRoot));
  const worktreeParent = path.dirname(path.resolve(worktree.path));
  const worktreeBaseName = path.basename(path.resolve(worktree.path));

  return worktree.detached &&
    areSamePath(worktreeParent, repoParent) &&
    worktreeBaseName.startsWith(`${repoName}-detached-`)
    ? 'default'
    : 'custom';
}

export function toYesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function areSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function runCommand(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const status = result.status ?? 1;

  if (status !== 0 && !options.allowFailure) {
    const renderedCommand = [command, ...args].join(' ');
    const message = stderr.trim() || stdout.trim() || `Command failed with exit code ${status}.`;
    throw new Error(`${renderedCommand}: ${message}`);
  }

  return { stdout, stderr, status };
}

function reportError(error: unknown): void {
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    return;
  }

  process.stderr.write(`Unknown error: ${String(error)}\n`);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${String(value)}`);
}

function installBrokenPipeHandler(): void {
  process.stdout.on('error', error => {
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
      process.exit(0);
    }

    throw error;
  });
}

installBrokenPipeHandler();

if (!process.env.VITEST) {
  void main().catch(error => {
    reportError(error);
    process.exitCode = 1;
  });
}
