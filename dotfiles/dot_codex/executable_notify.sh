#!/usr/bin/env bash
set -euo pipefail

# Read JSON from 1st arg (file path or raw JSON) or stdin
if [[ ${1-} ]]; then
  if [[ -f $1 && -r $1 ]]; then
    payload="$(cat -- "$1")"
  else
    payload="$1"
  fi
else
  payload="$(cat)"
fi

# Extract message + inputs (support kebab_case & snake_case)
msg="$(jq -r '."last-assistant-message" // ."last_assistant_message" // .message // empty' <<<"$payload")"
inputs="$(jq -r '(."input-messages" // ."input_messages" // []) | if type=="array" then join(" ; ") else empty end' <<<"$payload")"

# Compose body with sensible fallbacks
if [[ -n $inputs && -n $msg ]]; then
  body="$inputs → $msg"
elif [[ -n $inputs ]]; then
  body="$inputs"
elif [[ -n $msg ]]; then
  body="$msg"
else
  body="$(jq -c '.' <<<"$payload")"
fi

notify-send -t 6000 "Codex" "$body"
