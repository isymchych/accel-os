# Repository Guidelines

## Project Structure & Module Organization

- `firefox/` holds `user.js` prefs; outside chezmoi because profile IDs vary.
- `docs/` contains platform notes (`docs/linux`, `docs/mac`); keep secrets out and reference `.chezmoidata` instead.
- `scripts/` holds repository checks, formatting helpers, and host verification.
- `packages/commands/` is the private npm workspace for installed Node
  TypeScript `mb-*` commands.
- `ai/` holds skills and automation for coding agents (Codex, Pi).

### dotfiles/

- `dotfiles/` is the chezmoi source tree for `$HOME`.
- `dotfiles/dot_*` map to dotfiles in `$HOME`; keep the prefix to control target paths.
- Chezmoi ignores source files whose names already start with `.`; if the target begins with `.`, name the source `dot_<name>` (e.g. `dot_yas-parents`).
- `dotfiles/dot_config/` mirrors `~/.config`; prefer `.tmpl` variants when values differ per host.
- `dotfiles/bin/` maps to `~/bin`; name command shims `executable_<tool>` so chezmoi marks them executable on apply.
- `run_once_*.sh` and `run_onchange_*.sh.tmpl` in `dotfiles/` provision hosts; guard them with OS checks and make them idempotent.

## Build, Test, and Development Commands

- `chezmoi diff` — review pending changes before every apply.
- `chezmoi apply --dry-run --verbose` — render templates without touching the host.
- `chezmoi apply` — sync confirmed updates; pair with `--include`/`--exclude` to scope risky runs.
- `chezmoi doctor` — verify environment readiness after dependency changes.
- `chezmoi data` — inspect template inputs before editing `.tmpl` files.
- `just check` — run the canonical repository verification suite.
- `just fmt` / `just fmt-check` — format or verify all supported source formats.
- `just lint`, `just typecheck`, and `just test` — run targeted repository checks.
- `just doctor` — verify the declared Arch host configuration.
- `npm run typecheck --workspace @accel-os/commands` — verify installed Node
  command implementations before changing wrappers.
- `npm test --workspace @accel-os/commands` — run installed command tests.

## Coding Style & Naming Conventions

- `.editorconfig` enforces UTF-8, LF, and two-space indentation; adhere in all languages.
- Bash scripts start with `#!/usr/bin/env bash` and `set -euo pipefail`; refactor shared logic into helpers.
- Name executable scripts `executable_<tool>` so chezmoi marks them executable on apply.
- Keep template variables lowercase snake_case and derive host details from `.chezmoidata`.

## Repository Scripts and Node Commands

- Store repository automation in `scripts/`; keep its cohesive shared modules in
  `scripts/lib/`.
- Store installed Node command entry points in `packages/commands/bin/` and
  command-only shared modules in `packages/commands/lib/`.
- Run scripts directly with Node's native TypeScript type stripping; do not add a build step unless explicitly needed.
- Keep `scripts/tsconfig.json` and `packages/commands/tsconfig.json` aligned with Node type stripping: `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, and `rewriteRelativeImportExtensions` stay enabled.
- Avoid TypeScript syntax that Node cannot erase, including enums, parameter properties, runtime namespaces, decorators, import aliases, and path aliases.
- Use explicit `.ts` extensions for relative imports and `import type` for type-only imports.
- Wrap each installed CLI with `dotfiles/bin/executable_mb-<name>`; wrappers run
  `packages/commands/bin/<entrypoint>.ts` through `accel-node`.
- Add installed-command runtime dependencies to `packages/commands/package.json`.
  Add dependencies used only by repository scripts to the private root package.
  Keep shared development tooling at the root workspace.

## Theme Switching Scripts

- Pair every app-specific theme toggle with matching scripts in `dotfiles/dot_local/share/dark-mode.d/` and `dotfiles/dot_local/share/light-mode.d/`, named `executable_<app>-theme.sh`.
- Keep scripts minimal: shebang, blank line, then a single command that swaps the light and dark tokens (typically a `sed -i --follow-symlinks` substitution mirroring the rest of the repo).
- Keep the literal theme tokens in sync with their tracked dotfiles (e.g. `dotfiles/dot_config/alacritty/alacritty.toml`) so the sed substitutions match what chezmoi installs.

## Testing Guidelines

- Run `shellcheck bin/<script>` (or `bash -n`) before committing shell changes.
- Execute `chezmoi diff` and `chezmoi apply --dry-run` on macOS and Linux when touching OS-conditional templates.
- For Node shims, invoke the wrapped tool (`npm run lint`, etc.) to confirm path resolution.
- Store Emacs ERT tests in `dotfiles/dot_config/emacs/tests/`, name them `*-test.el`, and run syntax, Checkdoc, and ERT validation with `./scripts/check-emacs`.
- Format Emacs Lisp with `./scripts/format-emacs`; use `./scripts/format-emacs --check` for non-mutating verification.
- Emacs tests must load the actual configuration modules rather than copying their definitions, and must clean up modified global state, windows, buffers, hooks, and temporary files.
- Document manual verification steps in commit messages when automation is impossible.

## Commit & Pull Request Guidelines

- Commits use short, lowercase, imperative titles (`fix mac files on linux` style) and stay scoped.
- Include rationale and affected hosts in the body when behavior changes.

## AI / Codex Skills

- When creating or editing coding-agent prompts or skills, read and follow `$ACCEL_OS/ai/SKILLS_AND_PROMPTS_INTENT.md`.
- Skill helper scripts should be Node TypeScript run directly with `node`, not Deno or Python.
- When a skill references cross-folder policy docs, use `$ACCEL_OS` absolute paths because relative paths drift by working directory.

## Best Practices

- When writing Pi tool prompt guidance, describe the tool's user-visible value and routing criteria because internal jargon and negative unsupported-argument framing make model tool selection less reliable.
- When parsing JSON at Node script boundaries, define a TypeBox schema near the external shape and parse through `@accel-os/shared/json` so validation stays canonical and trusted code receives typed data.
- When parsing external CLI/API JSON, keep boundary schemas permissive for extra fields on provider-owned nested objects and normalize into strict internal domain types because providers can add or return undocumented metadata.
- Prefer named domain/result types over nested utility types such as `Promise<Awaited<ReturnType<typeof fn>>>`; explicit types keep public helper contracts readable.
- When inspecting installed Pi package APIs in this repo, start from root-level `node_modules/@earendil-works/*/dist/*.d.ts` and exclude `*.map` from code searches because workspace dependencies are hoisted and sourcemaps make compiled output noisy.
- When changing dotfiles behavior that introduces or depends on installed tools, update the relevant platform docs so fresh-host setup stays reproducible.
- Before formatting files, inspect the repository's declared formatter and scripts, then use that formatter directly; do not invoke an undeclared formatter through `npx` because it can produce incompatible output or download untracked tooling.
- When debugging behavior in a live Emacs session, suggest running `M-x server-start` so `emacsclient` can inspect the actual buffers, windows, modes, and effective keybindings.

## Intent Ledger

- Preserve personal operational and application preferences in platform setup guides; this repository is a personal workstation runbook, not a general-purpose distribution guide.
- For Sway session daemons, prefer user systemd units pulled by `sway-session.target`; keep `dotfiles/dot_config/sway/config` focused on compositor settings and keybindings.
- For terminal-backed GUI launches in dotfiles, prefer the `xterm` shim over hardcoded terminal emulators so backend selection stays centralized.
- When runtime helpers are needed by multiple workspaces, put them in an explicit workspace package such as `packages/shared` rather than a root-level `lib/`, so dependency ownership and imports remain clear.
- For local npm workspace dependencies, use the package's declared version such as `"0.0.0"`; do not use the `workspace:` protocol because npm does not support it.
- For Pi constrained tool sampling, enable strict JSON-schema sampling only on schemas compatible with provider strict mode; OpenAI strict tools require every declared property to be listed in `required`, so TypeBox optional properties need nullable-normalization or must remain non-strict.
- Keep Zsh completion functions for `mb-*` commands in `dotfiles/bin/completions/`; `~/bin/completions` was added to `fpath` before `compinit` so ChezMoi installs and Zsh discovers them together.
- Treat `dotfiles/.chezmoidata/packages.yaml` as the source of truth for packages required by tracked Linux desktop configuration; keep `docs/linux/README.md` focused on bootstrap, manual, hardware-specific, and optional setup instead of duplicating that inventory.
- Keep baseline environment for repo-managed commands in `dotfiles/dot_zshenv_tools`; reserve `dot_zshrc_tools` for interactive shell behavior and `dot_run-sway` for graphical-session configuration.
- Resolve host features, packages, services, and host-specific settings in `dotfiles/.chezmoitemplates/resolved-host-state`; provisioning templates and `just doctor` must consume that canonical resolved state instead of independently interpreting `.chezmoidata`.
- Keep `Justfile` as the canonical interface for repository checks, formatting,
  tests, and host verification; npm scripts expose JavaScript workspace tooling
  rather than cross-runtime orchestration.

## Pi Configuration

- Pi config in this repo lives under `ai/pi/` and is the source of truth for this machine.
- Edit `ai/pi/` for Pi settings, models, and keybindings, including files such as `ai/pi/settings.json`, `ai/pi/models.json`, and `ai/pi/keybindings.json`.
- When adding a new Pi tool that should be agent-callable by default, also add it to the default `--tools` allowlist in `ai/pi/ai.ts`; loading an extension alone does not enable the tool when `ai.ts` passes an explicit allowlist.
- Do not edit `~/.pi/agent/*` unless the user explicitly asks for a one-off live change there.
- On this machine, `ai/pi/` is also the live Pi config because `dotfiles/dot_zshenv_tools` defaults `PI_CODING_AGENT_DIR` to that path.
- For local MCP servers in `ai/pi/mcp.json`, prefer repo-local package binaries over `npx`; use the package's public bin name, set `cwd` to `${ACCEL_OS}/ai/pi`, and extend `PATH` with `${ACCEL_OS}/ai/pi/node_modules/.bin` so the config stays reproducible without wrapper scripts or internal package paths.

* When adding new Pi extension - don't forget to add high-level tsdoc to it

## Machine-Specific Configuration

- Favor templates (`.tmpl`) or `.chezmoi.osRelease` checks over duplicating configs.
- Keep secrets and host-only files ignored via `.chezmoiignore`.
- In `.chezmoiignore`, patterns operate on the rendered target tree (e.g. `.config/...`, `.local/bin/<tool>`, `.local/share/chezmoi/run_onchange_*.sh`); the file is templated even without a `.tmpl` suffix, so gate OS-specific blocks accordingly.
- Use `dot_zshrc_local.tmpl` and `run_onchange_*` scripts for overrides; defaults must stay safe cross-platform.

## Local Environment

- Current host OS: Arch Linux (ID=arch).
- DE/WM: Sway (Wayland).

# Tips

- download small files to tmp folder instead of repeated web fetches