#!/usr/bin/env bash
set -euo pipefail

payload='{"type":"agent-turn-complete","last-assistant-message":"Turn Complete!","input-messages":["test prompt","another input"]}'

bash "$ACCELERANDO_HOME/dotfiles/bin/executable_ai-notify" "$payload"
