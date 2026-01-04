#!/usr/bin/env bash
set -euo pipefail

bundle_dir="$HOME/.vim/bundle/Vundle.vim"

if ! command -v git >/dev/null; then
  printf >&2 'vim setup: git not found\n'
  exit 1
fi

if [ ! -d "$bundle_dir/.git" ]; then
  rm -rf "$bundle_dir"
  git clone https://github.com/VundleVim/Vundle.vim.git "$bundle_dir"
else
  git -C "$bundle_dir" pull --ff-only
fi

if ! command -v vim >/dev/null; then
  printf >&2 'vim setup: vim not found\n'
  exit 0
fi

vim +PluginInstall +qall
