# Pagoda agent guide

Local-only Hono/React app with browser and Electron clients in private pnpm workspace
`@accel-os/pagoda`. Root `../../AGENTS.md` governs this workspace.

## Intent Ledger

- Assume the normal configured local environment. Do not add compatibility checks, fallback
  behavior, or recovery paths for hypothetical environment failures without an evidenced need.
- I prefer tanstack ecosystem

## Read before changing

- For behavior changes, read [DOMAIN.md](docs/domain.md) and the
  [workspace specification](docs/specs/workspace.md).
- For integration changes, read [ARCHITECTURE.md](docs/architecture.md): it owns process, import,
  HTTP, and security boundaries, including reuse of the `ai/pi/` RPC entry rather than private
  imports.
- Before expanding scope, read [VISION.md](docs/vision.md); [DECISIONS.md](docs/decisions.md)
  explains the consequential tradeoffs.

## Documentation ownership and updates

- `docs/vision.md` owns product intent, scope, and non-goals. Update it when an approved decision
  changes product direction or scope; do not add a parallel intent document.
- `docs/domain.md` owns vocabulary, ownership, and domain invariants. Update it when those meanings
  or rules change.
- `docs/specs/workspace.md` owns approved behavior and client-boundary policies. Update it for
  approved requirement changes, not merely to match existing code. It describes the agreed target,
  not proof that implementation is complete.
- `docs/architecture.md` explains current structure, integration boundaries, and consequential
  implementation choices. Update it when those change; link to the spec for behavioral requirements
  rather than independently defining them. Mark implementation gaps explicitly.
- `docs/decisions.md` records significant accepted technical choices and their tradeoffs. Add a
  decision when rationale matters for future changes; mark superseded decisions rather than
  rewriting their history.
- `docs/development.md` and `README.md` own contributor and user instructions respectively. Update
  them when the affected reader needs different instructions.

Existing code and architecture descriptions do not establish new product requirements. Keep ideas
and proposals distinct from accepted decisions; ask before adding consequential obligations.
Rejected behavior must not become a migration requirement just because its code still exists. Update
the owning document without duplicating its rules elsewhere. Documentation authorization does not
authorize implementation changes.

## UI and validation

Use shadcn/ui with Base UI and Lucide icons; `components.json` configures component generation.
Forward native attributes/events. Shared controls stay domain-free; features own labels, values,
state, and feedback. Keep semantic theme tokens in `src/renderer/theme.css`.

Use system fonts; do not add bundled fonts. Generate components from this directory with
`pnpm dlx shadcn@4.23.0 add <component>` rather than keeping the CLI as a project dependency.

Run workspace commands from this directory. Follow [development](docs/development.md#development)
for startup and explicit restart rules that protect active work.

Use Node's test runner for focused/integration checks and Playwright browser tests for full
frontend/HTTP/backend journeys; keep Electron checks focused on its shell. Follow
[development checks](docs/development.md#checks) for isolated, credential-free execution and the
distinction between fake RPC wiring and real Pi compatibility.

Choose focused checks according to the root validation guidance. `pnpm run check` runs the full
workspace verification suite. `pnpm run test:e2e` covers frontend/HTTP/backend and Electron journeys
and includes the production build. When running a broader check, do not separately repeat checks it
includes unless intervening changes require revalidation.

Disclose missing display or Electron prerequisites. Follow
[display prerequisites](docs/development.md#display-prerequisites) before GUI checks; do not open
unexpected windows. Report tool and extension coverage limits. Required checks must pass or their
outstanding failures must be reported precisely. pnpm scripts own workspace tooling; Just recipes
are convenience wrappers.