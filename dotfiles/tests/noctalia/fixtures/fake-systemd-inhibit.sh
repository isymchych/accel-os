#!/usr/bin/env bash
set -euo pipefail

# Test-only stand-in: record the exact request without contacting logind.
printf '%s\n' "$@" > "$INHIBITOR_ARGS"
while [[ "${1:-}" == --* ]]; do shift; done
"$@"
printf 'released\n' > "$INHIBITOR_ARGS.released"
