# Development and verification

Run workspace commands from `ai/pagoda/`.

## Development

```sh
pnpm run dev
```

This compiles main/preload, starts Vite on `127.0.0.1:5173`, and opens Electron with Chromium
DevTools. React edits update live. Restart explicitly after main/preload or Pi-integration edits.
Electron's main process can be debugged separately with its Node inspector.

Renderer refresh keeps Pi running. Quitting the app closes Pi and active work.

The launcher passes the selected profile, working directory, and navigation backend as explicit
process arguments, not renderer-exposed settings. Tests use a separate entry point to inject fake Pi
execution and isolated desktop storage; normal startup does not expose those overrides.

## Checks

```sh
pnpm run check
pnpm run build
pnpm run test:e2e
```

`check` runs workspace formatting, lint, TypeScript checks, and Node integration tests. E2E uses the
installed Electron binary and exercises the built renderer, sandboxed preload, IPC, main process,
and a deterministic fake Pi child.

Root `just check` remains the repository gate. Workspace `Justfile` recipes are optional wrappers
around pnpm commands.

### Test isolation and compatibility

Use fake providers or deterministic execution, harmless tools, and isolated temporary state. Never
use real provider credentials in automated tests.

Configured-Pi checks use synthetic credentials and a local fake model to exercise actual extensions,
read/shell execution, shell termination, native persistence, discovery/navigation, and independent
fork execution while the source streams. Fake RPC checks establish application wiring; extension
compatibility requires configured-Pi checks, and these checks cover only the tools and extensions
they exercise.

Verify actual configured tool-process termination as well as fake cancellation. Report tool and
extension coverage limits explicitly.

### Verification scenarios

- Launcher UI selection, terminal argument passthrough, account selection, and launch settings.
- JSONL chunking and Unicode separators, final-message replacement, request rejection, child exit,
  unsupported-dialog cancellation, Stop confirmation, and shutdown cleanup.
- Built renderer/preload/main journeys: submit/stream, renderer reload during work, draft
  preservation, untrusted text rendering, and clean quit.
- Directory/session selection, sequential terminal/desktop handoff, persisted-history reopening,
  history navigation and fork preservation, explicit follow-ups, model/thinking controls, and long
  content.
- Concurrent session activity, independent drafts, pending Send/Stop confirmations across view
  changes, and reuse of an active session's execution owner.

### Display prerequisites

E2E opens visible windows on the configured graphical display. Before running GUI checks, arrange an
isolated virtual display or obtain agreement to use the active desktop. The runner uses its
inherited display environment. If a suitable display is unavailable, report E2E as unverified.

- [ ] Tooling TODO: automate isolated virtual-display setup for Electron E2E.