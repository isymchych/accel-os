# Decisions

## ADR-001: Use system Chromium for E2E

Use the installed Chromium executable for E2E, defaulting to `/usr/bin/chromium` and allowing
`WORKSPACE_CHROMIUM_PATH` to override it. Share the host's browser installation and rerun E2E after
Chromium or Playwright updates to verify compatibility.

## ADR-002: Use Solid 2 with native controls

Use Solid 2 and its Vite plugin for the browser client, with Hono RPC and a Node server. Pin tested
prerelease versions and run the workspace checks on upgrades.

Use locally owned styled native controls. Add routing for navigation across multiple screens and
richer primitives for concrete interaction requirements.