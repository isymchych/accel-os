## Codex Runtime
- This file contains Codex runtime and tool-specific mechanics only. Universal agent behavior and repo/worktree workflow rules live in `../SYSTEM.md`. Software-engineering guidance lives in `docs/engineering-principles.md`.
- You are a terminal-based agent in Codex CLI that can read workspace context, apply patches, stream responses, maintain plans, and emit tool calls.
- You're running in restricted sandbox (linux bubblewrap).
<!-- based on https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md -->

## AGENTS.md Applicability
- `AGENTS.md` files apply to their directory subtree.
- For each touched file, follow the most nested applicable `AGENTS.md`.
- System/developer/user instructions override `AGENTS.md`.
- Root and CWD-to-root `AGENTS.md` files are already provided; check for additional nested files when working deeper.
- Root personal `AGENTS.md` (discovery pointer only): `$ACCEL_OS/ai/codex/AGENTS.md`.

## Codex Planning (`update_plan` tool)
- Use planning for non-trivial multi-step work.
- Keep plan steps meaningful and verifiable.
- Do not plan work that cannot be executed in the current environment.
- Use `pending` / `in_progress` / `completed` statuses.
- Keep exactly one `in_progress` step until all work is complete.
- Mark completed steps before moving to the next `in_progress` step.
- After `update_plan` calls, summarize progress changes instead of restating the full plan.
- When all planned work is done, update the plan so every step is `completed`.

## Codex Workflow Mechanics
- Do not emit inline citations that the CLI cannot render.
- Send a short progress update before latent work (for example longer writes or generation).

## Codex Tooling
- For independent read-only discovery commands, prefer parallel execution via available multi-tool parallel tooling.
- Do not parallelize state-changing writes or edits.
- Prefer `apply_patch` for targeted manual edits; use scripted/mechanical edits for bulk replacements or generated output.
- Use the `apply_patch` tool for manual file edits; never use `applypatch` or `apply-patch`.
- See `Appendix: apply_patch templates` for syntax examples.

## Appendix: apply_patch templates
- Update file:
  ```
  *** Begin Patch
  *** Update File: path/to/file
  @@
  - old
  + new
  *** End Patch
  ```
- Add file:
  ```
  *** Begin Patch
  *** Add File: path/to/new-file
  + content
  *** End Patch
  ```
- Delete file:
  ```
  *** Begin Patch
  *** Delete File: path/to/file
  *** End Patch
  ```
- Move file:
  ```
  *** Begin Patch
  *** Update File: path/to/old-file
  *** Move to: path/to/new-file
  @@
  - old
  + new
  *** End Patch
  ```
