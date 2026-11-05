#!/usr/bin/env bash
set -euo pipefail

failed_units() {
  local scope=$1
  local -a command=(systemctl)

  if [[ "$scope" == user ]]; then
    command+=(--user)
  fi

  "${command[@]}" --failed --no-legend --plain --no-pager 2>/dev/null |
    awk '{print $1}'
}

emit_status() {
  local -a system_units=()
  local -a user_units=()

  mapfile -t system_units < <(failed_units system)
  mapfile -t user_units < <(failed_units user)

  local total=$((${#system_units[@]} + ${#user_units[@]}))
  if ((total == 0)); then
    jq -cn '{
      text: "",
      class: ["systemd-failed-units", "systemd-failed-units--ok"]
    }'
    return
  fi

  jq -cn \
    --arg text "$total" \
    '{
      text: $text,
      class: ["systemd-failed-units", "systemd-failed-units--degraded"]
    }'
}

case "${1:-status}" in
  status)
    emit_status
    ;;
  *)
    printf 'usage: %s [status]\n' "$0" >&2
    exit 2
    ;;
esac
