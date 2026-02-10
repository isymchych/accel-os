---
name: prune-stale-branches
description: Prune stale GitHub remote branches in the current repo using a safe dry-run-first workflow. Use when asked to delete old branches, clean up stale remote branches, or identify branches older than 3 weeks; for `spr/*`, prune only when linked PR is closed/merged, and for other branches prune only when not ahead of the main branch.
---

# Prune Stale Branches

Use this skill to safely prune stale remote branches via:
- `$ACCELERANDO_HOME/ai/codex/skills/prune-stale-branches/scripts/prune-stale-branches.ts`

## Preconditions

- Run in the target git repository.
- `origin` remote exists.
- `gh` is authenticated and has repo access.
- Run the script with escalated permissions (`sandbox_permissions: require_escalated`) because it performs network operations (`git fetch`, GitHub API via `gh`).

## Workflow

1. Confirm main branch name (`main` by default).
2. Run dry-run first:
   - `$ACCELERANDO_HOME/ai/codex/skills/prune-stale-branches/scripts/prune-stale-branches.ts --dry-run`
   - execute with escalation
3. Show the complete candidate list from command output to the user.
4. Run deletion only after explicit confirmation:
   - require user confirmation text: `proceed delete`
   - run:
     - `$ACCELERANDO_HOME/ai/codex/skills/prune-stale-branches/scripts/prune-stale-branches.ts --confirm-delete DELETE_STALE_BRANCHES`
     - execute with escalation
5. If main branch differs:
   - `$ACCELERANDO_HOME/ai/codex/skills/prune-stale-branches/scripts/prune-stale-branches.ts --main <branch> --dry-run`
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
