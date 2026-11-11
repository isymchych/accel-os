# Pagoda agent guide

Local-only Electron/React app in private pnpm workspace `@accel-os/pagoda`. Root `../../AGENTS.md`
governs this workspace.

Use engineering judgment within the requested scope and accepted product and architecture decisions.

## Read before changing

- For behavior changes, read [DOMAIN.md](docs/domain.md) and the
  [workspace specification](docs/specs/workspace.md).
- For integration changes, read [ARCHITECTURE.md](docs/architecture.md): it owns process, import,
  IPC, and security boundaries, including reuse of the `ai/pi/` RPC entry rather than private
  imports.
- Before expanding scope, read [VISION.md](docs/vision.md); [DECISIONS.md](docs/decisions.md)
  explains the consequential tradeoffs.

## UI and validation

Use shadcn/ui with Base UI and Lucide icons; `components.json` configures component generation.
Forward native attributes/events. Shared controls stay domain-free; features own labels, values,
state, and feedback. Keep semantic theme tokens in `src/renderer/theme.css`.

Use system fonts; do not add bundled fonts. Generate components from this directory with
`pnpm dlx shadcn@4.23.0 add <component>` rather than keeping the CLI as a project dependency.

Run commands from this directory: `pnpm run dev`, `pnpm run build`, `pnpm run start`,
`pnpm run check`, and `pnpm run test:e2e`. Plain Vite owns renderer hot updates; main/preload
changes require explicit restart.

Use Node's test runner for focused/integration checks and Playwright's Electron support for full
renderer/preload/main journeys. Follow [development checks](docs/development.md#checks) for
isolated, credential-free execution and the distinction between fake RPC wiring and real Pi
compatibility.

For Pagoda-only changes, run `pnpm run check`. Run `pnpm run test:e2e` for affected
renderer/preload/main journeys; it includes the desktop build. Use root `just check` for shared
code, repository tooling, or cross-area changes. When running a broader check, do not separately
repeat checks it includes unless intervening changes require revalidation.

Disclose missing display or Electron prerequisites. Follow
[display prerequisites](docs/development.md#display-prerequisites) before GUI checks; do not open
unexpected windows. Report tool and extension coverage limits. Required checks must pass or their
outstanding failures must be reported precisely. pnpm scripts own workspace tooling; Just recipes
are convenience wrappers.