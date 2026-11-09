set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export ACCEL_OS := justfile_directory()

alias c := check

default:
  @just --list

fmt:
  ./dotfiles/scripts/emacs/format-emacs
  npm run fmt

fmt-check:
  ./dotfiles/scripts/emacs/format-emacs --check
  npm run fmt:check

typecheck:
  npm run typecheck

lint:
  npm run lint

test:
  npm run test

check-completions:
  node dotfiles/scripts/check-completions.ts

check-host-config:
  node dotfiles/scripts/check-host-config.ts

check-emacs:
  node dotfiles/scripts/emacs/check-emacs.ts

# Static Noctalia checks are separate so the full gate runs behavior tests only once.
[private]
check-noctalia-static:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ "$(uname -s)" != Linux ]]; then
    printf '%s\n' 'Skipping Linux-only Noctalia plugin checks.'
    exit 0
  fi
  noctalia plugins lint dotfiles/dot_config/noctalia/plugins/*
  luau-analyze dotfiles/dot_config/noctalia/plugins/*/*.luau

check-noctalia: check-noctalia-static
  npm run test:noctalia --workspace dotfiles

doctor:
  node dotfiles/scripts/doctor.ts

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

# Check host configuration, completions, Emacs, Noctalia, and dotfiles tooling.
check-dotfiles: check-host-config check-completions check-emacs check-noctalia-static
  ./dotfiles/scripts/emacs/format-emacs --check
  npm run fmt:check --workspace dotfiles
  npm run lint --workspace dotfiles
  npm run typecheck --workspace dotfiles
  npm test --workspace dotfiles

# Full gate, including shared code and global formatting.
check: check-completions check-host-config check-emacs check-noctalia-static fmt-check lint typecheck test
