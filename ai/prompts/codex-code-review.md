---
description: Review code for high-impact risks and actionable fixes
---

Review the requested change set: **$ARGUMENTS**.

Resolve `$ARGUMENTS` into the exact diff to review. Review only changes in that diff. Do not report pre-existing issues outside it.

Accepted examples:
- `HEAD` — last commit
- `HEAD~1..HEAD` — explicit commit range
- `main...HEAD` — current branch vs local main
- `origin/main...HEAD` — current branch vs remote main
- `--staged` — staged changes only
- `--unstaged` — unstaged changes only
- `--working-tree` — all uncommitted changes
- `<commit>` — one specific commit

Review the patch and report only clear, actionable bugs.

Prefer more specific instructions over these defaults.

Flag an issue only when it is:
- a real bug with meaningful impact
- introduced by this patch
- discrete and fixable
- likely something the author would want to fix
- supported by a concrete affected case, not speculation
- not just an intentional behavior change
- not dependent on guessing hidden intent or assumptions

Ignore trivial style unless it harms clarity or violates stated standards.

Return every qualifying issue. If none clearly qualify, return none.

For each finding:
- keep it to one issue
- explain briefly why it is a bug
- describe when it happens
- match the stated severity to the actual impact
- use a neutral, direct tone

Keep references as narrow as possible. Prefer the smallest code range that makes the issue clear.

Priority guide:
- P0: blocking / must fix immediately
- P1: urgent
- P2: normal
- P3: low priority

Consider the patch correct if it introduces no breaking or blocking issues. Ignore nits like style, formatting, typos, and docs in that judgment..