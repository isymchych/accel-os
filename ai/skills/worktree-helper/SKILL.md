---
name: worktree-helper
description: Manage repo-local git worktrees through the standalone `mb-worktree` command. Use when asked to create, inspect, or remove a project worktree from an existing ref, a new branch from an explicit base ref, `origin/main`, or a same-repo GitHub pull request, and when flags like `--no-setup`, `--force`, or `--delete-branch` are relevant.
---

# Worktree Helper

Use this skill to manage repo-local git worktrees through the standalone helper instead of hand-writing raw `git worktree` or `gh` command sequences.

## Preferred entrypoint

Run `mb-worktree <command> ...`.

Default targeting:
- `mb-worktree` targets the caller's current repository.
- Use `--repo <path>` when the target repo is not the current directory.
- Relative `--repo` paths resolve from the caller's original working directory.

Start with:
- `mb-worktree list`
- `mb-worktree --help`

## Preconditions

- Determine the target git repository before running the helper.
- If using `--repo`, verify the path points at the intended repository.
- Run with the permissions needed for git and `gh` operations when the selected command performs fetches or PR lookups.

## Workflow

1. Determine the target repository.
2. Choose the command path:
   - Existing branch / remote branch / tag / commit:
     - `mb-worktree checkout <ref>`
   - New branch from an explicit base:
     - `mb-worktree new-branch <branch> --from <ref>`
   - New branch from `origin/main`:
     - `mb-worktree new-from-main <branch>`
   - Same-repo GitHub PR:
     - `mb-worktree new-from-pr <url-or-number>`
   - Remove a worktree:
     - `mb-worktree remove <branch-or-path>`
     - add `--delete-branch` to delete the local branch after removal
     - add `--force` to skip the confirmation prompt
     - add `--no-setup` on create commands to skip `setup-worktree.sh`
     - add `--repo <path>` when operating on a repo outside the current directory

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
