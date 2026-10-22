set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export ACCEL_OS := justfile_directory()

alias c := check

default:
  @just --list

fmt:
  ./scripts/format-emacs
  npm run fmt

fmt-check:
  ./scripts/format-emacs --check
  npm run fmt:check

typecheck:
  ./node_modules/.bin/tsc --project scripts/tsconfig.json --noEmit
  npm run typecheck

lint:
  npm run lint

test:
  node --test scripts/*.test.ts
  npm run test

check-completions:
  node scripts/check-completions.ts

check-host-config:
  node scripts/check-host-config.ts

check-emacs:
  ./scripts/check-emacs

doctor:
  node scripts/doctor.ts

# Check all AI workspaces without running commands or dotfiles checks.
check-ai:
  npm run fmt:check:ai
  npm run lint:ai
  npm run typecheck --workspace ai/pi --workspace ai/skills --workspace ai/workspace
  npm run test --workspace ai/pi --workspace ai/skills --workspace ai/workspace

# Check installed commands and their completion declarations.
check-commands: check-completions
  npm run fmt:check:commands
  npm run lint:commands
  npm run typecheck --workspace packages/commands
  npm run test --workspace packages/commands

# Check host configuration, completions, Emacs, and dotfiles Markdown.
check-dotfiles: check-host-config check-completions check-emacs
  ./scripts/format-emacs --check
  npm run fmt:check:dotfiles

# Full gate, including shared code, repository tooling, and global formatting.
check: check-completions check-host-config check-emacs fmt-check lint typecheck test
