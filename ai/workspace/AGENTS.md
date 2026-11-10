# Pi workspace agent guide

Local-only Electron/React app in private pnpm workspace `@accel-os/workspace`. Root
`../../AGENTS.md` governs this workspace.

## Read before changing

- For behavior changes, read [DOMAIN.md](docs/domain.md) and the [release outcomes](docs/mvp.md).
- For integration changes, read [ARCHITECTURE.md](docs/architecture.md): it owns process, import,
  IPC, and security boundaries, including reuse of the `ai/pi/` RPC entry rather than private
  imports.
- Before expanding scope, read [VISION.md](docs/vision.md); [DECISIONS.md](docs/decisions.md)
  explains the consequential tradeoffs.
- Before visual work, read [DESIGN.md](docs/design.md). It is a proposal, not authorization to
  redesign unrelated UI.

## UI and validation

Use React and native controls, forwarding native attributes/events. Shared controls stay
domain-free; features own labels, values, state, and feedback. Preserve existing semantic theme
tokens.

Run commands from this directory: `pnpm run dev`, `pnpm run build`, `pnpm run start`,
`pnpm run check`, and `pnpm run test:e2e`. Plain Vite owns renderer hot updates; main/preload
changes require explicit restart.

Use Node's test runner for focused/integration checks and Playwright's Electron support for full
renderer/preload/main journeys. Follow [MVP acceptance checks](docs/mvp.md#acceptance-checks) for
isolated, credential-free execution and the distinction between fake RPC wiring and real Pi
compatibility.

Run the desktop build and Electron E2E alongside root `just check`; disclose missing display or
Electron prerequisites. Follow [README display prerequisites](README.md#checks) before GUI checks;
do not open unexpected windows. pnpm scripts own workspace tooling; Just recipes are convenience
wrappers.