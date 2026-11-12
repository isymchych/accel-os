# Development and verification

Run workspace commands from `ai/pagoda/`.

## Development

```sh
pnpm run dev
```

This builds the backend and Electron shell, starts Vite on `127.0.0.1:5173`, and starts the backend
on `127.0.0.1:4317`. Open its printed connection URL in a browser; no window opens automatically.
This development server is separate from the normal launcher-owned UI.

React edits update live. Restart explicitly after backend/Pi-integration edits, or restart Electron
after shell edits. Source watchers must not restart active agent work.

### Startup options

Production uses `pnpm run build` then `pnpm run start`. The server accepts `--cwd` and `--port`
(default 4317). Test execution overrides are unavailable in normal startup.

For launcher usage, see [Setup and run](../README.md#setup-and-run). `AI_CWD` overrides the launch
directory.

The Electron npm package downloads its matching binary on first execution if it is not cached.

## Checks

```sh
pnpm run check
pnpm run test:e2e
```

`check` runs formatting, lint, TypeScript checks, and Node integration tests. `test:e2e` includes
the production build. Browser journeys exercise the real frontend and HTTP/SSE backend with fake SDK
execution and native persistence; Electron checks cover shell isolation, shared state, and quit
behavior. SDK journeys use the actual SDK against a local synthetic provider, including account
selection and owner credential affinity. Ordinary journeys use the application API; targeted fault
tests cover stale responses and rejection.

For browser-only iteration without a graphical display or Xvfb, run `pnpm run test:e2e:browser`. The
full `test:e2e` command also checks Electron.

Choose focused checks for the changed behavior under the root validation guidance. Workspace
`Justfile` recipes are optional wrappers around pnpm commands.

### Test isolation and compatibility

Use fake providers or deterministic execution, harmless tools, and isolated temporary state. Never
use real provider credentials in automated tests.

Fake SDK checks establish application wiring, not Pi compatibility. Configured-Pi checks use
synthetic credentials and a local fake model to exercise actual SDK tools, native history, and
concurrent fork execution. They establish compatibility only for what they exercise.

Verify actual configured tool-process termination as well as fake cancellation. Report tool and
extension coverage limits explicitly.

### Display prerequisites

On Linux, browser tests use the installed `/usr/bin/chromium`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
to use another installed Chromium executable. Other platforms use Playwright's installed Chromium
unless that override is set. Install its browser prerequisites before running E2E. Tracing is
disabled to avoid recording connection credentials.

On Linux, `test:e2e` runs Electron on a temporary Xvfb/X11 display, not the active Wayland desktop,
and cleans it up afterward. Arch provisioning includes `xorg-server-xvfb`; install it before running
E2E on an existing host.

On other platforms, E2E uses the inherited graphical display and opens visible windows. Obtain
agreement to use the active desktop before running it. If the required display support is
unavailable, report E2E as unverified.