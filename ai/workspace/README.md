# Pi workspace

Local-only Electron + React UI for the existing Pi coding-agent configuration in `../pi/`. Electron
owns windows and Pi RPC children; Pi owns execution and native session persistence.

The app supports one session for the launch directory, plain-text streaming, basic tool activity,
Stop, renderer reattachment, and clean shutdown. [First-release outcomes](MVP.md#release-outcomes)
track the remaining UI work.

## Setup and run

From the repository root, install locked dependencies:

```sh
pnpm install --frozen-lockfile
```

From `ai/workspace/`:

```sh
pnpm run build
pnpm run start
```

Or, after building, run `ai ui` from the directory where Pi should work. It uses the existing
selected account profile; choose a different one with `ai account` in the terminal first. Pass Pi
arguments through the terminal interface with `ai`; launch the desktop with `ai ui`.

The Electron npm package downloads its matching binary on first execution if it is not cached. The
app uses the repository's Node runtime to run configured Pi; it does not run agent code inside the
renderer or copy credentials into desktop storage. A graphical Linux/macOS session is required.

## Development

```sh
pnpm run dev
```

This compiles main/preload, starts Vite on `127.0.0.1:5173`, and opens Electron with Chromium
DevTools. React edits update live. Restart explicitly after main/preload or Pi-integration edits.
Electron's main process can be debugged separately with its Node inspector.

Renderer refresh keeps Pi running. Quitting the app closes Pi and active work. Reopen persisted
history through Pi; unfinished execution requires a fresh run after an app or machine crash.

Production startup loads `dist/`; rebuild after source changes.

## Checks

From this directory:

```sh
pnpm run check
pnpm run build
pnpm run test:e2e
```

`check` runs workspace formatting, lint, TypeScript checks, and Node integration tests. E2E uses the
installed Electron binary. It starts the actual app with a deterministic fake Pi child, harmless
local processes, and temporary user data; no real credentials or model network calls are used.

E2E opens visible windows on the configured graphical display. Before running GUI checks, arrange an
isolated virtual display or obtain agreement to use the active desktop. The runner uses its
inherited display environment. If a suitable display is unavailable, report E2E as unverified.

- [ ] Tooling TODO: automate isolated virtual-display setup for Electron E2E.

Root `just check` remains the repository gate. Workspace `Justfile` recipes are optional wrappers
around pnpm commands.

## Configuration and compatibility

The desktop reuses the terminal's `ai/pi/` configuration and native session storage rather than
maintaining separate agent settings or credentials.

`AI_CWD` retains its existing launch-directory override. The launcher passes the selected profile,
working directory, and navigation backend through internal `AI_UI_*` variables; these are not
renderer-exposed settings. Integration tests override the RPC entry and desktop data directory to
keep test execution isolated.

Notifications are displayed. RPC select/confirm/input/editor dialogs receive explicit cancellation
with a visible notice; other presentation-only records are not rendered. Terminal components require
React adaptations; the existing `ask_user_question` disables itself outside TUI mode.

Agents have unsandboxed host filesystem and shell access; the working directory is not a security
boundary. See [execution authority](DOMAIN.md#execution-authority).

## Documentation

- [Vision](VISION.md): product scope and accepted direction.
- [Domain](DOMAIN.md): vocabulary, behavioral invariants, and lifecycle.
- [Architecture](ARCHITECTURE.md): process, IPC, configuration, and security boundaries.
- [First release](MVP.md): release outcomes, implementation status, and acceptance criteria.
- [Design](DESIGN.md): proposed presentation and interaction direction.
- [Decisions](DECISIONS.md): stack, integration, ownership, and lifecycle rationale.
- [Agent guide](AGENTS.md): development instructions.
- [Historical ideas](IDEAS.md): brainstorming, not an implementation queue.