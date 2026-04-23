---
name: prune-stale-branches
description: Prune stale GitHub remote branches in the current repo using a safe dry-run-first workflow. Use when asked to delete old branches, clean up stale remote branches, or identify branches older than 3 weeks; for `spr/*`, prune only when linked PR is closed/merged, and for other branches prune only when not ahead of the main branch.
---

# Prune Stale Branches

Use this skill to safely prune stale remote branches via:
- `deno run -A ./scripts/prune-stale-branches.ts`

## Available scripts
- Resolve all relative helper script paths against `dirname(SKILL.md)`, not the current working directory.
- Script path resolution and execution context are separate: resolving the helper path does not determine the working directory.
- Run bundled `.ts` helper scripts with `deno`, not `node`.
- For repository-aware helpers in this skill, run the helper with `cwd` set to the target repository, even when the helper script lives outside that repository.
- Before invoking a git-inspection helper, verify both the resolved helper path and the working directory.
- `scripts/prune-stale-branches.ts` — Performs dry-run or confirmed deletion of stale remote branches using git and GitHub API checks.

## Preconditions

- Determine the target git repository before running the helper.
- Run the helper with `cwd` set to the target git repository.
- Verify the resolved helper path and the execution `cwd` before the first helper invocation.
- `origin` remote exists.
- `gh` is authenticated and has repo access.
- Run the script with the permissions needed for network operations because it performs `git fetch` and GitHub API calls via `gh`.

## Workflow

1. Determine the target repository and confirm main branch name (`main` by default).
2. Resolve the helper path relative to `dirname(SKILL.md)` and verify it separately from execution context.
3. Verify the execution `cwd` is the intended target repository.
   If helper path resolution succeeds but `cwd` points at the wrong repo or a non-repo directory, stop and report the mismatch.
4. Run dry-run first, with `cwd` set to the target repository:
   - `deno run -A <resolved-path-to>/scripts/prune-stale-branches.ts --dry-run`
   - execute with escalation
5. Show the complete candidate list from command output to the user.
6. Run deletion only after explicit confirmation:
   - require user confirmation text: `proceed delete`
   - run:
     - `deno run -A <resolved-path-to>/scripts/prune-stale-branches.ts --confirm-delete DELETE_STALE_BRANCHES`
     - execute with escalation
7. If main branch differs:
   - `deno run -A <resolved-path-to>/scripts/prune-stale-branches.ts --main <branch> --dry-run`
   - execute with escalation

## Behavior

- Fetches and prunes `origin` references.
- Scans all branch refs using GitHub GraphQL pagination.
- Builds a full candidate set first, then prints the complete list before any deletion.
- For `spr/*`: keep only branches with PR status closed or merged (no staleness check).
- For non-`spr/*`: require last push older than 3 weeks and not ahead of `origin/<main>`.
- Deletes only branches that satisfy the applicable rule above.
- If PR lookup fails or no PR exists for `spr/*`, skip the branch and report the reason.

## Output Contract

Report:
- command(s) run
- main branch used
- whether run mode was `dry-run` or `delete`
- full branch list selected for deletion
- branches actually deleted (delete mode)
- full skipped branch list with skip reasons
- skip reason counts
- follow-up confirmation step (if dry-run)

## Safety

- Always run `--dry-run` first unless user explicitly asks to skip.
- Delete mode requires explicit token: `--confirm-delete DELETE_STALE_BRANCHES`.
- Never delete the configured main branch.
- Stop on first command failure.
