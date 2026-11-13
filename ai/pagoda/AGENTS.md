# Pagoda agent guide

Local-only Effect/React app with browser and Electron clients in private pnpm workspace
`@accel-os/pagoda`. Root `../../AGENTS.md` governs this workspace.

## Intent Ledger

- Assume the normal configured local environment. Do not add compatibility checks, fallback
  behavior, or recovery paths for hypothetical environment failures without an evidenced need.
- I prefer tanstack ecosystem
- Import Effect Schema as `S`: `import { Schema as S } from "effect";`.

## Read and update by scope

- Behavior: [domain](docs/domain.md) for concepts and invariants;
  [workspace specification](docs/specs/workspace.md) for approved behavior and client policies.
- Integration: [architecture](docs/architecture.md) for current process, import, HTTP, and security
  boundaries; [decisions](docs/decisions.md) for tradeoffs and rejected integration policies.
- Scope expansion: [vision](docs/vision.md) for product direction and non-goals.
- Reader instructions: `README.md` for usage, [development](docs/development.md) for contribution
  and verification.

Update the owning document when its meaning or guidance changes, rather than duplicating it or
creating parallel intent documents. The spec describes the agreed target, not implementation
completeness; mark material gaps in architecture. Code does not establish requirements. Keep
proposals distinct from decisions and ask before adding consequential obligations. Preserve decision
history through supersession. Documentation changes do not authorize implementation.

## UI and validation

Use shadcn/ui with Base UI and Lucide icons; `components.json` configures component generation.
Forward native attributes/events. Shared controls stay domain-free; features own labels, values,
state, and feedback. Keep semantic theme tokens in `src/renderer/theme.css`.

Use system fonts; do not add bundled fonts. Generate components from this directory with
`pnpm dlx shadcn@4.23.0 add <component>` rather than keeping the CLI as a project dependency.

Run workspace commands from this directory. Follow [development](docs/development.md) for startup,
explicit restarts that protect active work, and isolated, credential-free verification.

Use Node's test runner for focused/integration checks, Playwright browser tests for full application
journeys, and Electron tests for the shell. Choose focused checks under the root validation
guidance; `pnpm run check` is the full workspace suite and `pnpm run test:e2e` includes the
production build. Avoid repeating checks already included in a broader run unless intervening
changes need revalidation.

Follow [display prerequisites](docs/development.md#display-prerequisites) before GUI checks; do not
open unexpected windows. Report missing prerequisites, outstanding required-check failures, and tool
or extension coverage limits. Fake execution verifies wiring, not Pi compatibility. pnpm scripts own
workspace tooling; Just recipes are convenience wrappers.