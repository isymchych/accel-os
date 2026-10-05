# AI workspace

Local, loopback-only browser and server foundation for the AI workspace.
The current screen submits diagnostic messages; agent runtime, persistence,
and streaming are not implemented.

See [ARCHITECTURE.md](ARCHITECTURE.md) for architecture requirements and intended
direction, [DECISIONS.md](DECISIONS.md) for consequential choices, and
[AGENTS.md](AGENTS.md) for development guidance.

## Development

Run the client and server together from this directory:

```sh
just dev
```

The launcher uses the `accel-workspace` tmux session, with the Vite client at
`http://127.0.0.1:5173` and the backend at `http://127.0.0.1:8787`.
Re-running the command attaches to the existing session. To end both processes,
run `tmux kill-session -t accel-workspace`.

`just server` and `just client` start either process separately.

## Production-style startup

Build the browser assets, then start the single-origin server:

```sh
npm run build
npm run start
```

The server listens only on `127.0.0.1:8787` by default and serves the built
client from `dist/`.

## Configuration

- `WORKSPACE_PORT` sets the backend port (default `8787`).
- `WORKSPACE_VITE_PORT` sets the Vite development port (default `5173`).
- `WORKSPACE_MODE` is `development` or `production`; the supplied scripts set
  the appropriate mode.
- `WORKSPACE_CHROMIUM_PATH` selects the system Chromium executable for E2E;
  it defaults to `/usr/bin/chromium`.

## Checks

```sh
npm run typecheck
npm test
npm run build
just test-e2e
```

E2E requires a compatible system Chromium; see [ADR-001](DECISIONS.md#adr-001-use-system-chromium-for-e2e).