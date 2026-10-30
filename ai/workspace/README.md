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

From this directory, build the browser assets once, then start the application:

```sh
just build
just start
```

Open `http://127.0.0.1:8787`. Stop with Ctrl-C. Subsequent starts use `just start` (or simply
`just`) without rebuilding. The npm equivalents are `npm run build` and `npm run start`.

There is one workflow, without a Vite development server, API proxy, automatic HMR, backend watcher,
or tmux launcher. Vite with Solid and Tailwind remains the browser compiler; Node runs backend
TypeScript directly.

## Updating the running application

The agreed target is one explicit [Check & Reload](DOMAIN.md#check-and-reload) action, coordinated
by a stable main process with a replaceable API child. **Reload, the process split, and
last-successful application candidates are not yet implemented.**

For now, stop the application, then run:

```sh
just check
just build
just start
```

The current server serves browser assets from `dist/` and runs backend source from the checkout. It
does not isolate a last-successful backend/capability version. Do not treat this manual restart as
the future execution-preserving reload.

## Configuration

- `WORKSPACE_PORT` sets the backend port (default `8787`).
- `WORKSPACE_CHROMIUM_PATH` selects the system Chromium executable for E2E; it defaults to
  `/usr/bin/chromium`.

The existing server still accepts `WORKSPACE_MODE` and reads `WORKSPACE_VITE_PORT`; those legacy
code paths have not been removed. The start command fixes `WORKSPACE_MODE=production` to serve the
built UI; users do not select a development/production mode.

## Checks

```sh
just check
just test-e2e
```

`just check` runs workspace formatting, lint, typechecking, and Node integration tests.
`just test-e2e` builds the browser and starts its own test server. E2E requires a compatible system
Chromium; see [ADR-001](DECISIONS.md#adr-001-use-system-chromium-for-e2e).