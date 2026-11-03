# AI workspace

Local browser/server foundation for the AI workspace: Solid 2 and Tailwind through Vite, with Hono
on Node. One loopback-only server serves the built browser UI and API. The diagnostic screen checks
browser-to-server communication.

Solid 2 and its Vite plugin use pinned prereleases. Review release notes and rerun checks on
upgrades.

## Documentation

Design documents describe intended behavior. The [MVP contract](MVP.md) defines first-release
integration; its [acceptance checks](MVP.md#acceptance-checks) establish readiness.

- [Vision](VISION.md): purpose, scope, and agreed MVP decisions.
- [Domain](DOMAIN.md): terms and behavioral rules.
- [Architecture](ARCHITECTURE.md): technical structure and constraints.
- [MVP contract](MVP.md): first-release integration requirements, open questions, and acceptance
  checks.
- [Design](DESIGN.md): visual and interaction guidance.
- [Decisions](DECISIONS.md): consequential choices and rationale.
- [Agent guide](AGENTS.md): development instructions.

## Run

From this directory, build the application once, then start it:

```sh
npm run build
npm run start
```

Open `http://127.0.0.1:8787`. Stop with Ctrl-C. Subsequent starts use `npm run start` without
rebuilding. The workspace Justfile also provides convenience commands.

Use this build-and-start workflow for both development and operation. Updates take effect through
**Check & Reload** or a full restart, as described below.

## Updating the running application

Use **Check & Reload** in the browser to run `npm run check` and `npm run build`, activate the
UI/API version, and refresh connected browsers. Checks and builds read the working tree directly;
edits made while they run are not detected and may produce output that differs from what was
checked.

Failed checks or builds leave the running version unchanged. Progress and outcomes remain available
after reconnection; detailed failures appear in the launching terminal. The diagnostic message is
saved per tab before refresh. If browser storage is unavailable, keep the tab open and copy the
message.

Launcher code, cross-process protocol, and dependency changes require a full build and restart.
After stopping the application, run:

```sh
npm run check
npm run build
npm run start
```

Run standalone `npm run build` only while the application is stopped; it prepares the application
for the next start. Use the browser action to update a running application.

Check & Reload currently covers the UI and API. Capability replacement and execution continuity
require the stable executor's agent-runtime integration and verification. The launcher supervises
the replaceable backend; product services belong in that backend, not the launcher.

After updating from the previous owner/API layout, stop the application and run the full
check/build/start sequence above once. Saved slot names and the `current` pointer are retained, but
the compiled launcher and application entrypoints have moved.

## Configuration

- `WORKSPACE_PORT` sets the backend port (default `8787`).
- `WORKSPACE_STATE_DIR` overrides the saved-application directory (default `.workspace/` here).
- `WORKSPACE_CHROMIUM_PATH` selects the system Chromium executable for E2E; it defaults to
  `/usr/bin/chromium`.

## Checks

```sh
npm run check
npm run test:e2e
```

`npm run check` runs workspace formatting, lint, typechecking, and Node integration tests.
`npm run test:e2e` builds and starts its own application with temporary saved state, including a
Check & Reload journey. E2E requires a compatible system Chromium; see
[ADR-001](DECISIONS.md#adr-001-use-system-chromium-for-e2e).