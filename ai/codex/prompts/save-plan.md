---
description: Save the COMPLETE current plan to a markdown file with all details preserved
---

Save the COMPLETE current plan to a markdown file at the path in `$ARGUMENTS`.
Do not summarize, compress, or omit details. Preserve all plan items, rationale, decisions, assumptions, dependencies, risks, constraints, and execution notes.

Path rules:
- Parse `$ARGUMENTS` as one path argument (support quoted paths).
- Resolve `~`, then normalize to an absolute path.
- Refuse to write outside the current workspace.
- If `$ARGUMENTS` is empty or still ambiguous after parsing:
  - Propose a default filename in the current workspace, e.g. `plan-snapshot-YYYY-MM-DD.md`.
  - Ask the user to confirm that proposed path (or provide a different one) and stop.

Write rules:
- Required output structure (exact section order):
  1. `# Plan Snapshot`
  2. `## Motivation`
  3. `## Key Decisions`
  4. `## Assumptions`
  5. `## Key Details`
  6. `## Important Context`
- Completeness requirements:
  - Include the full plan content in `## Key Details` (all phases, steps, subtasks, acceptance criteria, validation steps, and open questions if present).
  - Include all known context and constraints in `## Important Context`.
  - If any required section has no available content, explicitly write `None provided.` instead of omitting or paraphrasing.
- If parent directory does not exist, ask whether to create it before writing.
- If target file exists and is non-empty, ask for overwrite confirmation before writing.
- If path is invalid or not writable, report the error and stop.

Completion rule:
- After a successful write, respond with:
  - resolved file path
  - confirmation that all required sections were written
  - confirmation that the COMPLETE plan (with all available details) was saved without summarization
