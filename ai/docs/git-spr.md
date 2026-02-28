# Git SPR: Retargeting a Stack to a New Base Branch

## Goal
- Move an existing SPR stack from one base branch to another.
- Keep the stacked PR chain valid on GitHub.

## Core Rules
- `githubBranch` in SPR config defines the stack trunk target (bottom PR base).
- Existing PR base metadata may not be auto-retargeted just by changing config.
- Branch name prefixes like `spr/main/*` are not inherently wrong.
- Chain correctness is about PR `base`/`head` relationships, not branch name text.

## Required State Before Retarget
- Current working branch is your stack branch.
- Repo SPR config has `githubBranch: <target-base>`.
- Global SPR config (`~/.spr.yml`) does not override `githubBranch` to a different value.
- Git upstream for the working branch points to `origin/<target-base>`.

## One-Time Retarget Procedure
1. Set SPR trunk base in repo config:
```yaml
githubBranch: <target-base>
```

2. Ensure global config is not overriding the base:
```bash
cat .spr.yml
cat ~/.spr.yml
```

3. Set branch upstream to the target base:
```bash
git fetch origin
git branch --set-upstream-to=origin/<target-base>
git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

4. Rebase stack ancestry from old base onto target base:
```bash
git fetch origin
git rebase --onto origin/<target-base> "$(git merge-base HEAD origin/<old-base>)"
```

5. Sync PRs:
```bash
git spr update
```

## Correct PR Chain Shape
- Bottom PR: `base=<target-base>`, `head=<first stack branch>`.
- Every next PR must follow:
1. `base=<previous PR head branch>`
2. `head=<current PR head branch>`

If upper PRs are based on `spr/<target-base>/*` while heads stay on a different lineage (for example `spr/<old-base>/*`), the chain is mixed and status/conflict checks become noisy or broken.

## Verification Commands
- Local SPR/Git linkage:
```bash
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u}
cat .spr.yml
cat ~/.spr.yml
```

- PR base/head audit:
```bash
gh pr list --state open --limit 200 \
  --json number,baseRefName,headRefName,title,url \
  | jq -r '.[] | "#\(.number) base=\(.baseRefName) head=\(.headRefName) | \(.title) | \(.url)"'
```

- SPR status:
```bash
git spr st
```

## Known Failure Modes and Fixes

### 1) Panic: `invalid base branch for pull request:<target-base>`
Symptom:
- SPR logs show comparison against `origin/<old-base>..HEAD`.
- Then panic references PR base `<target-base>`.

Likely cause:
- Effective SPR base is inconsistent (repo/global config mismatch) or PR chain metadata is mixed.

Fix:
- Align `.spr.yml` and `~/.spr.yml` to `githubBranch: <target-base>` (or remove global override).
- Ensure upstream is `origin/<target-base>`.
- Rebase stack onto `origin/<target-base>`.
- Re-run `git spr update`.

### 2) Weird merge conflicts after base switch
Symptom:
- `git spr st` shows failing merge-conflict bits in upper stack PRs.

Likely cause:
- PR base chain is incorrect after partial retarget.

Fix:
- Retarget bases so each PR points to the previous PR head:
```bash
gh pr edit <pr_number> --base <expected_previous_head_branch>
```
- Keep only bottom PR on `<target-base>`.

### 3) Confusion about `spr/main/*` branch names
Clarification:
- These names can remain `spr/main/*` and still be valid.
- What must be correct is base/head linkage across the stack.

## Practical Recovery Pattern
1. Create a safety branch:
```bash
git branch backup/<name>-before-retarget
```
2. Audit config + upstream.
3. Audit PR base/head chain on GitHub.
4. Fix incorrect PR bases with `gh pr edit --base ...`.
5. Run `git spr st` and verify conflict bits.