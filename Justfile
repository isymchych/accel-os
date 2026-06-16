set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export ACCEL_OS := justfile_directory()

alias c := check

chezmoi := "chezmoi --source \"$ACCEL_OS/dotfiles\""

default:
  @just --list

fmt:
  npm run fmt

fmt-check:
  npm run fmt:check

typecheck:
  npm run typecheck

lint:
  npm run lint

test:
  npm run test

check: typecheck lint test fmt-check

apply-chezmoi:
  {{chezmoi}} apply

init-chezmoi:
  {{chezmoi}} init --destination "$HOME"

install-scripts:
  npm install --ignore-scripts

install-bin-tools:
  just -f bin-tools/justfile prod-build-install

bootstrap: apply-chezmoi install-scripts install-bin-tools
