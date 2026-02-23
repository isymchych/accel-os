  Analyze my git activity for last week across all branches in the current repo.

  Requirements:
  1. Time window: last calendar week (Monday 00:00 to Sunday 23:59), using absolute dates in output.
  2. Scope: all branches/refs (`--all`), only my commits (match current git `user.name`/`user.email` unless I override).
  3. Deduplicate cherry-picks/rebased duplicates by patch-id and report both:
     - raw totals (all commits found)
     - unique totals (deduped patches)
  4. Output sections:
     - Executive summary (3–6 bullets)
     - Totals: commits, unique changes, insertions/deletions, file changes
     - Daily breakdown (commit counts by date)
     - Area breakdown (top directories touched)
     - Key changes grouped by theme
     - Duplicate/cherry-pick note (which commit messages repeated and how many times)
  5. Format: concise Markdown report I can paste into Slack/Notion.
  6. If data is ambiguous, state assumptions explicitly.

  Optional overrides:
  - Author override: <name/email/regex>
  - Date range override: <YYYY-MM-DD .. YYYY-MM-DD>
  - Include per-branch table: yes/no