#!/usr/bin/env bash
set -euo pipefail

if ! command -v deno >/dev/null 2>&1; then
  exit 0
fi

: "${ACCELERANDO_HOME:?ACCELERANDO_HOME must point at repo root}"
export DENO_NO_UPDATE_CHECK=1
cd "$ACCELERANDO_HOME/scripts"

shopt -s nullglob
scripts=(./scripts/*.ts)
if (( ${#scripts[@]} == 0 )); then
  exit 0
fi

deno cache --lock=deno.lock "${scripts[@]}"
