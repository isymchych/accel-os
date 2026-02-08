---
description: Map a repository and produce a concrete, source-backed AGENTS.md
---

Task:
Map this repository and create/update `AGENTS.md` so another coding agent can run, test, and modify it safely with minimal exploration.

Non-negotiable rules:
- Source-backed only: document facts traceable to files in this repo.
- No invention: never fabricate commands, architecture, conventions, env vars, or workflows.
- Prefer exactness: include concrete paths, filenames, command strings, and tool names.
- Concise technical writing only: no tutorials or basics.
- Unknowns explicit: when evidence is missing, write `unknown` and name what is missing.

Evidence collection order:
1. `README*` and existing `AGENTS.md` (if present).
2. Root manifests and lockfiles (`package.json`, `Cargo.toml`, `pyproject.toml`, workspace files).
3. CI/CD definitions (`.github/workflows/*`, other pipeline configs).
4. Test/lint/typecheck/format configs and scripts.
5. Entry-point files (CLI binaries, servers, workers, libraries) and major module directories.

Extract and record:
- Repository purpose and primary use cases.
- Tech stack, runtimes, package/build tools.
- Entry points and how each is invoked.
- Directory map of major folders and responsibilities.
- Test layout plus exact test commands.
- Lint/format/typecheck commands.
- Required env/config files and where they are read.
- CI/CD and release flow (only if present in repo).
- External integrations/services.
- Sensitive or high-risk areas (auth, crypto, migrations, schemas, stateful data paths).

AGENTS.md output contract:
- Update existing `AGENTS.md` in place when present; otherwise create it.
- Preserve correct existing sections; remove stale/incorrect content.
- Keep output actionable for automated agents.
- Include, at minimum:
  - Repo overview (quick orientation).
  - Directory map with concrete paths.
  - Exact run/build/test/lint/typecheck commands.
  - Change-safety constraints and repo conventions inferred from code/config.
  - Validation expectations before submitting changes.
  - Known gotchas, invariants, and non-obvious design decisions.

Final validation before completion:
- Every command appears verbatim in repo files (scripts/config/CI), or is marked `unknown`.
- Every referenced directory/file exists.
- Every claimed entry point is traceable to a concrete file.
- No boilerplate advice detached from repo evidence.
- Only `AGENTS.md` is modified.
