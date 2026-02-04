# Repository Guidelines

## Project Structure & Module Organization
- `bin-tools/` is the Rust CLI tools crate (backlight/volume/mic/touchpad helpers).
- `firefox/` holds `user.js` prefs; outside chezmoi because profile IDs vary.
- `docs/` contains platform notes (`docs/linux`, `docs/mac`); keep secrets out and reference `.chezmoidata` instead.
- `scripts/` holds Deno tasks (`scripts/scripts/`) and shared modules (`scripts/lib/`).
- `ai/` holds Codex skills and automation.

### dotfiles/
- `dotfiles/` is the chezmoi source tree for `$HOME`.
- `dotfiles/dot_*` map to dotfiles in `$HOME`; keep the prefix to control target paths.
- Chezmoi ignores source files whose names already start with `.`; if the target begins with `.`, name the source `dot_<name>` (e.g. `dot_yas-parents`).
- `dotfiles/dot_config/` mirrors `~/.config`; prefer `.tmpl` variants when values differ per host.
- `dotfiles/bin/` holds `executable_*` shims that chezmoi installs to `~/.local/bin`.
- `run_once_*.sh` and `run_onchange_*.sh.tmpl` in `dotfiles/` provision hosts; guard them with OS checks and make them idempotent.

## Build, Test, and Development Commands
- `chezmoi diff` — review pending changes before every apply.
- `chezmoi apply --dry-run --verbose` — render templates without touching the host.
- `chezmoi apply` — sync confirmed updates; pair with `--include`/`--exclude` to scope risky runs.
- `chezmoi doctor` — verify environment readiness after dependency changes.
- `chezmoi data` — inspect template inputs before editing `.tmpl` files.

## Coding Style & Naming Conventions
- `.editorconfig` enforces UTF-8, LF, and two-space indentation; adhere in all languages.
- Bash scripts start with `#!/usr/bin/env bash` and `set -euo pipefail`; refactor shared logic into helpers.
- Node shims stick to CommonJS; extend `bin/.bin-utils.js` instead of cloning lookup logic.
- Name executable scripts `executable_<tool>` so chezmoi marks them executable on apply.
- Keep template variables lowercase snake_case and derive host details from `.chezmoidata`.

## Scripts (Deno)
- Store scripts in `scripts/scripts/` and shared modules in `scripts/lib/`.
- Add tasks in `scripts/deno.json` with `--lock=deno.lock --frozen --cached-only`.
- Wrap each task with `dotfiles/bin/executable_mb-<name>`; wrapper `cd`s into `$ACCELERANDO_HOME/scripts` and runs `deno task mb-<name>`.
- Put `DENO_NO_UPDATE_CHECK=1` in Deno wrapper shell scripts (`dotfiles/bin/executable_*`, cache scripts) 
- Cache all entrypoints via `scripts/cache-mb-scripts.sh` (globs `./scripts/*.ts`).
- Confirm cache/lock policy before dismissing dependency changes.
- Don’t assume --cached-only means “no new deps”; ask if recache is allowed.
- When Deno std is needed, prefer jsr:@std/* and align with repo policy or ecosystem guidance.

## Theme Switching Scripts
- Pair every app-specific theme toggle with matching scripts in `dotfiles/dot_local/share/dark-mode.d/` and `dotfiles/dot_local/share/light-mode.d/`, named `executable_<app>-theme.sh`.
- Keep scripts minimal: shebang, blank line, then a single command that swaps the light and dark tokens (typically a `sed -i --follow-symlinks` substitution mirroring the rest of the repo).
- Keep the literal theme tokens in sync with their tracked dotfiles (e.g. `dotfiles/dot_gemini/settings.json`) so the sed substitutions match what chezmoi installs.

## Testing Guidelines
- Run `shellcheck bin/<script>` (or `bash -n`) before committing shell changes.
- Execute `chezmoi diff` and `chezmoi apply --dry-run` on macOS and Linux when touching OS-conditional templates.
- For Node shims, invoke the wrapped tool (`npm run lint`, etc.) to confirm path resolution.
- Document manual verification steps in commit messages when automation is impossible.

## Commit & Pull Request Guidelines
- Commits use short, lowercase, imperative titles (`fix mac files on linux` style) and stay scoped.
- Include rationale and affected hosts in the body when behavior changes.

## Machine-Specific Configuration
- Favor templates (`.tmpl`) or `.chezmoi.osRelease` checks over duplicating configs.
- Keep secrets and host-only files ignored via `.chezmoiignore`.
- In `.chezmoiignore`, patterns operate on the rendered target tree (e.g. `.config/...`, `.local/bin/<tool>`, `.local/share/chezmoi/run_onchange_*.sh`); the file is templated even without a `.tmpl` suffix, so gate OS-specific blocks accordingly.
- Use `dot_zshrc_local.tmpl` and `run_onchange_*` scripts for overrides; defaults must stay safe cross-platform.

## Local Environment
- Current host OS: Arch Linux (ID=arch).
- DE/WM: Sway (Wayland).