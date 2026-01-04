#!/usr/bin/env bash
set -euo pipefail

# 25-minute Pomodoro timer backend for the Waybar custom module.

readonly DURATION_SECONDS=1500
readonly STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/waybar"
readonly STATE_FILE="$STATE_DIR/pomodoro_timer_state"
DEFAULT_LABEL=$(printf '%02d:%02d' $((DURATION_SECONDS / 60)) $((DURATION_SECONDS % 60)))
readonly DEFAULT_LABEL

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

write_state() {
  ensure_state_dir
  local tmp_file
  tmp_file=$(mktemp "$STATE_FILE.XXXX")
  printf '%s\n' "$1" >"$tmp_file"
  mv "$tmp_file" "$STATE_FILE"
}

read_state() {
  [[ -f "$STATE_FILE" ]] || return 1
  local stored
  stored=$(<"$STATE_FILE")
  if [[ "$stored" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$stored"
    return 0
  fi
  rm -f "$STATE_FILE"
  return 1
}

reset_state() {
  rm -f "$STATE_FILE"
}

format_time() {
  local total_seconds=$1
  (( total_seconds < 0 )) && total_seconds=0
  printf '%02d:%02d' $((total_seconds / 60)) $((total_seconds % 60))
}

emit_status() {
  local state=$1
  local seconds=${2:-0}
  local text tooltip class_suffix
  case "$state" in
    running)
      text="$(format_time "$seconds")"
      tooltip="Pomodoro running - $(format_time "$seconds") remaining"
      class_suffix='pomodoro--running'
      ;;
    done)
      text='DONE'
      tooltip='Pomodoro finished'
      class_suffix='pomodoro--done'
      ;;
    *)
      text="$DEFAULT_LABEL"
      tooltip='Pomodoro idle'
      class_suffix='pomodoro--idle'
      ;;
  esac
  printf '{"text":"%s","tooltip":"%s","class":["pomodoro","%s"]}\n' "$text" "$tooltip" "$class_suffix"
}

notify_complete() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -t 10000 "Pomodoro" "Timer completed"
  fi
}

start_timer() {
  if read_state >/dev/null; then
    return
  fi
  write_state "$(date +%s)"
}

reset_timer() {
  reset_state
}

check_timer() {
  local now start_ts elapsed remaining
  if ! start_ts=$(read_state); then
    emit_status idle "$DURATION_SECONDS"
    return
  fi

  now=$(date +%s)
  elapsed=$((now - start_ts))
  if (( elapsed < 0 )); then
    reset_state
    emit_status idle "$DURATION_SECONDS"
    return
  fi

  remaining=$((DURATION_SECONDS - elapsed))
  if (( remaining <= 0 )); then
    reset_state
    notify_complete
    emit_status 'done' 0
    return
  fi

  emit_status running "$remaining"
}

main() {
  local cmd=${1:-}
  case "$cmd" in
    start)
      start_timer
      ;;
    check)
      check_timer
      ;;
    reset)
      reset_timer
      ;;
    *)
      printf 'usage: %s <start|check|reset>\n' "$0" >&2
      exit 1
      ;;
  esac
}

main "$@"
