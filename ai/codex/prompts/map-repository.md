---
description: Map a repository and produce a concise, source-backed AGENTS.md
---

Task:
Map this repository and create/update `AGENTS.md` at the repo root so another coding agent can run, test, and modify it with minimal exploration.

Requirements:
- Include a short codebase map that helps an agent find files quickly.
- Focus on entry points, directory roles, naming conventions, configuration wiring, and test locations.
- Add a section called `Local norms` with repo-specific rules inferred from code and tooling.
- Add a section called `Self-correction` with both instructions, explicitly:
  - If the code map is discovered to be stale, update it.
  - If the user gives a correction about how work should be done in this repo, add it to `Local norms` (or another clearly labeled section) so future sessions inherit it.

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
- Preserve correct existing sections; remove stale/incorrect content.
- Keep it concise, navigation-first, and actionable for automated agents.
- Include at minimum:
  - Repo overview (quick orientation).
  - Directory map with concrete paths.
  - Entry points and invocation paths.
  - Exact run/build/test/lint/typecheck commands.
  - Required env/config files and where they are read.
  - Test locations.
  - CI/CD and release flow (if present).
  - Change-safety constraints and repo conventions inferred from code/config.
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
- Only `AGENTS.md` is modified.
