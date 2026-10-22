# AI workspace

Local browser/server foundation for the AI workspace: Solid 2 and Tailwind through Vite, with Hono
on Node. Both servers are loopback-only. The diagnostic screen checks browser-to-server
communication.

Solid 2 and its Vite plugin use pinned prereleases. Review release notes and rerun checks on
upgrades.

## Documentation

Design documents describe intended behavior.
[MVP integration status](MVP.md#modelruntime-integration-status) records implementation evidence and
remaining checks.

- [Vision](VISION.md): purpose, scope, and agreed MVP decisions.
- [Domain](DOMAIN.md): terms and behavioral rules.
- [Architecture](ARCHITECTURE.md): technical structure and constraints.
- [MVP implementation](MVP.md): first-release integration details, open questions, and acceptance
  checks.
- [Design](DESIGN.md): visual and interaction guidance.
- [Decisions](DECISIONS.md): consequential choices and rationale.
- [Agent guide](AGENTS.md): development instructions.

## Development

Run the client and server together from this directory:

```sh
just dev
```

This starts the `accel-workspace` tmux session: client at `http://127.0.0.1:5173`, backend at
`http://127.0.0.1:8787`. Run it again to attach; end both with
`tmux kill-session -t accel-workspace`.

Use `just server` or `just client` to start either separately.

## Production-style startup

Build the browser assets, then start the single-origin server:

```sh
npm run build
npm run start
```

The server listens only on `127.0.0.1:8787` by default and serves the built client from `dist/`.

## Configuration

- `WORKSPACE_PORT` sets the backend port (default `8787`).
- `WORKSPACE_VITE_PORT` sets the Vite development port (default `5173`).
- `WORKSPACE_MODE` is `development` or `production`; the supplied scripts set the appropriate mode.
- `WORKSPACE_CHROMIUM_PATH` selects the system Chromium executable for E2E; it defaults to
  `/usr/bin/chromium`.

## Checks

```sh
npm run typecheck
npm test
npm run build
just test-e2e
```

E2E requires a compatible system Chromium; see
[ADR-001](DECISIONS.md#adr-001-use-system-chromium-for-e2e).