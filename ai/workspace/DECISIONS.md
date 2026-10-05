# Decisions

## ADR-001: Use system Chromium for E2E

Use the installed Chromium executable for E2E, defaulting to `/usr/bin/chromium` and allowing `WORKSPACE_CHROMIUM_PATH` to override it. This avoids a separate Playwright browser download, but browser updates can affect compatibility; rerun E2E after browser or Playwright updates.