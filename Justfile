set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

export ACCELERANDO_HOME := justfile_directory()

chezmoi := "chezmoi --source dotfiles"

default:
  @just --list

diff:
  {{chezmoi}} diff

doctor:
  {{chezmoi}} doctor

dry-run:
  {{chezmoi}} apply --dry-run --verbose

apply:
  {{chezmoi}} apply

# Explicitly run what `run_onchange_install-packages.sh.tmpl` would do on Arch.
packages:
  {{chezmoi}} execute-template < dotfiles/run_onchange_install-packages.sh.tmpl | bash

cache:
  bash scripts/cache-mb-scripts.sh

vim:
  bash dotfiles/run_once_install-vim.sh

macos-defaults:
  bash dotfiles/run_once_macos-defaults.sh

provision: packages apply cache

# Local PKGBUILD helpers (keep PKGBUILDs in project dirs).
pkg-build dir:
  cd "{{dir}}" && makepkg --syncdeps --cleanbuild

pkg-install dir:
  cd "{{dir}}" && makepkg --syncdeps --cleanbuild
  sudo pacman -U "{{dir}}"/*.pkg.tar.*
