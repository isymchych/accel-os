---
name: worktree-helper
description: Manage repo-local git worktrees through the bundled `scripts/worktree.ts` helper. Use when asked to create, inspect, or remove a project worktree from an existing ref, a new branch from an explicit base ref, `origin/main`, or a same-repo GitHub pull request, and when flags like `--no-setup`, `--force`, or `--delete-branch` are relevant.
---

# Worktree Helper

Use this skill to manage repo-local git worktrees through the bundled helper script instead of hand-writing raw `git worktree` or `gh` command sequences.

## Available scripts

- Resolve all relative helper script paths against `dirname(SKILL.md)`, not the current working directory.
- Script path resolution and execution context are separate: resolving the helper path does not determine the working directory.
- Run bundled `.ts` helper scripts with `deno`, not `node`.
- For repository-aware helpers in this skill, run the helper with `cwd` set to the target repository, even when the helper script lives outside that repository.
- Before invoking the helper, verify both the resolved helper path and the working directory.
- `scripts/worktree.ts` — Manages repo-local git worktrees for list/create/remove flows, including same-repo PR checkouts and optional setup hook execution.

## Preferred entrypoint

Run `deno run -A <resolved-path-to>/scripts/worktree.ts <command> ...` with `cwd` set to the target repository.

Start with:
- `deno run -A <resolved-path-to>/scripts/worktree.ts list`
- `deno run -A <resolved-path-to>/scripts/worktree.ts --help`

## Preconditions

- Determine the target git repository before running the helper.
- Run the helper with `cwd` set to the target repository.
- Verify the resolved helper path and the execution `cwd` before the first helper invocation.
- Run with the permissions needed for git and `gh` operations when the selected command performs fetches or PR lookups.

## Workflow

1. Determine the target repository.
2. Resolve the helper path relative to `dirname(SKILL.md)` and verify it separately from execution context.
3. Verify the execution `cwd` is the intended target repository.
   If helper path resolution succeeds but `cwd` points at the wrong repo or a non-repo directory, stop and report the mismatch.
4. Choose the command path:
   - Existing branch / remote branch / tag / commit:
     - `deno run -A <resolved-path-to>/scripts/worktree.ts checkout <ref>`
   - New branch from an explicit base:
     - `deno run -A <resolved-path-to>/scripts/worktree.ts new-branch <branch> --from <ref>`
   - New branch from `origin/main`:
     - `deno run -A <resolved-path-to>/scripts/worktree.ts new-from-main <branch>`
   - Same-repo GitHub PR:
     - `deno run -A <resolved-path-to>/scripts/worktree.ts new-from-pr <url-or-number>`
   - Remove a worktree:
     - `deno run -A <resolved-path-to>/scripts/worktree.ts remove <branch-or-path>`
     - add `--delete-branch` to delete the local branch after removal
     - add `--force` to skip the confirmation prompt
     - add `--no-setup` on create commands to skip `setup-worktree.sh`

## Behavior notes

- Worktrees use canonical sibling paths like `../<repo>-<branch>`.
- `checkout origin/foo` creates a local branch when the remote-tracking name is unambiguous, but fails if the same-named local branch already exists.
- `checkout <tag-or-commit>` creates a detached sibling worktree path like `../<repo>-detached-...`.
- `new-from-pr` supports only same-repo PRs, derives the path from the PR head branch name, and fails if the same-named local branch already exists after fetch.
- After creating a worktree, the helper checks for `./setup-worktree.sh` in the target repo root and runs it as `./setup-worktree.sh <new-worktree-path>` when present.
- Pass `--no-setup` to skip that setup hook.
- If the canonical worktree already exists for the same target, the helper returns success and prints the path.
- If the target branch is already checked out in another worktree, the helper refuses to create a duplicate.

## Safety and troubleshooting

- Prefer the helper over ad-hoc `git worktree` commands so path, PR, and setup-hook behavior stays consistent.
- Use `list` before `remove` when unsure which path/branch to target.
- `remove` prompts when the worktree has tracked changes, untracked files, or local commits; use `--force` only when the removal is intentional.
- If the command fails because sandboxed git/gh writes are blocked, request escalation and rerun the same helper command.

## Output expectations

Return a short report with:
- the command run
- the resolved worktree path
- whether `setup-worktree.sh` ran, was skipped, or was absent
- any safety condition hit (`already exists`, branch already checked out elsewhere, PR rejected, removal forced)

## Example requests

- `Use $worktree-helper to open fix-loan-status from origin.`
- `Use $worktree-helper to create los-refactor from main.`
- `Use $worktree-helper to open PR 699.`
- `Use $worktree-helper to remove change-rank and delete the branch.`
