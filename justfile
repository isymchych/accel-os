set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export ACCELERANDO_HOME := justfile_directory()

chezmoi := "chezmoi --source \"$ACCELERANDO_HOME/dotfiles\""

default:
  @just --list

apply-chezmoi:
  {{chezmoi}} apply

init-chezmoi:
  {{chezmoi}} init --destination "$HOME"

install-scripts:
  bash scripts/cache-mb-scripts.sh

install-bin-tools:
  just -f bin-tools/justfile prod-build-install

bootstrap: apply-chezmoi install-scripts install-bin-tools
