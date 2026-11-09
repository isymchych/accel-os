set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export ACCEL_OS := justfile_directory()

alias c := check

default:
  @just --list

fmt:
  ./dotfiles/scripts/emacs/format-emacs
  pnpm run fmt

fmt-check:
  ./dotfiles/scripts/emacs/format-emacs --check
  pnpm run fmt:check

typecheck:
  pnpm run typecheck

lint:
  pnpm run lint

test:
  pnpm test

check-completions:
  pnpm --filter @accel-os/dotfiles run check:completions

check-host-config:
  pnpm --filter @accel-os/dotfiles run check:host-config

check-emacs:
  pnpm --filter @accel-os/dotfiles run check:emacs

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
  pnpm --filter @accel-os/dotfiles run test:noctalia

doctor:
  pnpm --filter @accel-os/dotfiles run doctor

# Check all AI workspaces without running commands or dotfiles checks.
check-ai:
  pnpm run fmt:check:ai
  pnpm run lint:ai
  pnpm --filter './ai/*' run typecheck
  pnpm --filter './ai/*' test

# Check installed commands and their completion declarations.
check-commands: check-completions
  pnpm run fmt:check:commands
  pnpm run lint:commands
  pnpm --filter @accel-os/commands run typecheck
  pnpm --filter @accel-os/commands test

# Check host configuration, completions, Emacs, Noctalia, and dotfiles tooling.
check-dotfiles: check-host-config check-completions check-emacs check-noctalia-static
  ./dotfiles/scripts/emacs/format-emacs --check
  pnpm --filter @accel-os/dotfiles run fmt:check
  pnpm --filter @accel-os/dotfiles run lint
  pnpm --filter @accel-os/dotfiles run typecheck
  pnpm --filter @accel-os/dotfiles test

# Full gate, including shared code and global formatting.
check: check-completions check-host-config check-emacs check-noctalia-static fmt-check lint typecheck test
