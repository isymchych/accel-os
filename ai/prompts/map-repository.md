---
description: Create or update the repository's AGENTS.md with a source-backed codebase map and guidance
argument-hint: "[mapping emphasis or constraints]"
---

Task:
Map this repository and create/update `AGENTS.md` at the repo root so another coding agent can run, test, and modify it with minimal exploration.
This task authorizes writing only that file, not changing implementation or granting permission for future edits.
Use `$ACCEL_OS/ai/skills/normative-documents/SKILL.md` for requirement-preserving document edits.

User-provided emphasis or constraints (if any):
$ARGUMENTS

Requirements:

- Include a short codebase map that helps an agent find files quickly.
- Focus on entry points, directory roles, naming conventions, configuration wiring, and test locations.
- Add a section called `Local norms` that distinguishes established requirements from observed conventions. Label patterns inferred from code as observations, not mandatory rules; identify the source of established requirements.
- Add a section called `Self-correction` with both instructions, explicitly:
  - If the code map is discovered to be stale, propose the correction; apply it only when existing authorization covers the edit or the user approves it.
  - Treat user corrections as candidates for durable guidance, not automatic additions. Distinguish task-specific instructions from lasting project rules, prefer the narrowest existing owner, and persist only with authorization covering that destination.

Non-negotiable rules:

- Source-backed only: document facts traceable to files in this repo.
- No invention: never fabricate commands, architecture, conventions, env vars, or workflows.
- Prefer exactness: use concrete paths, filenames, command strings, and tool names.
- Concise technical writing only: no tutorials or basics.
- Unknowns explicit: when evidence is missing, write `unknown` and name what is missing.

Process:

1. Use search and targeted file reads. Do not read every file.
2. Prefer `rg` to find entry points, manifests, config wiring, and tests.
3. Start with high-signal files/paths:
   - `README*`
   - existing `AGENTS.md` (if present)
   - `pyproject.toml`, `package.json`, `Cargo.toml`, lockfiles, workspace manifests
   - `Makefile`, `Justfile`
   - `opencode.json`
   - `.github/workflows/*` and other CI configs
   - top-level `src/` or `app/` directories
4. Drill deeper only as needed to verify: entry points, commands, conventions, config/env loading, tests, CI/release, integrations, and high-risk areas.

AGENTS.md output contract:

- Update existing `AGENTS.md` in place when present; otherwise create it.
- Preserve correct existing sections and authoritative requirements. Correct stale factual descriptions when repository evidence establishes the correction; do not remove or weaken requirements merely because current code differs. Surface unresolved conflicts for a user decision.
- Keep it concise, navigation-first, and actionable for automated agents.
- Include at minimum:
  - Repo overview (quick orientation).
  - Directory map with concrete paths.
  - Entry points and invocation paths.
  - Exact run/build/test/lint/typecheck commands.
  - Required env/config files and where they are read.
  - Test locations.
  - CI/CD and release flow (if present).
  - Established change-safety requirements and separately labeled conventions observed in code/config.
  - `Local norms`.
  - `Self-correction`.
  - Validation expectations before submitting changes.
  - Known gotchas, invariants, and non-obvious design decisions.
- Write the final `AGENTS.md` contents in Markdown.

Final validation before completion:

- Every command appears verbatim in repo files (scripts/config/CI), or is marked `unknown`.
- Every referenced directory/file exists.
- Every claimed entry point is traceable to a concrete file.
- No boilerplate advice detached from repo evidence.
- Observed patterns are not presented as mandatory rules, and requirement changes remain within authorization.
- Only `AGENTS.md` is modified.