# AI workspace agent guide

Private npm workspace `@accel-os/workspace`: a loopback-only React/Vite client
and Hono/Node server. The current application is a diagnostic connectivity
screen; agent runtime, persistence, and SSE are not implemented.

Root `../../AGENTS.md` governs this workspace. Paths below are relative to
`ai/workspace/`.

## Ownership and navigation

| Path                                    | Owner                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| `client/app/`                           | Browser bootstrap, navigation, and composition              |
| `client/ui/`, `client/styles/theme.css` | Domain-free primitives and semantic theme tokens            |
| `client/lib/`                           | Browser infrastructure and Hono RPC transport               |
| `server/app/`                           | Startup, shutdown, HTTP guards, assets, and API composition |
| `contracts/`                            | Environment-neutral TypeBox wire schemas and derived types  |
| `tests/integration/`, `tests/e2e/`      | Cross-boundary Node checks and browser journeys             |

Features own product policy; `lib/` and `ui/` remain domain-free. Add feature
subdirectories when an implemented slice needs them, not to scaffold the
illustrative architecture tree.

Client code must not import server implementation values or Node-only modules;
server code must not import client code. The intentional Hono RPC type-only
edge is confined to `client/lib/api.ts`. Keep server syntax erasable for Node's
native TypeScript execution; Vite owns browser compilation.

## Read before changing

- `README.md`: development, startup, configuration, and check commands.
- `ARCHITECTURE.md`: canonical architecture requirements. Read ownership and
  boundary validation for structural/API changes; runtime and persistence for
  integration changes; transport and recovery for submission/stream changes;
  frontend and accessibility for UI changes; security before enabling execution.
- `DECISIONS.md`: consequential choices, including system Chromium for E2E.

Architecture proposals are not implemented features. Initial product scope and
execution authority remain undecided; resolve them before real user interactions
and tool execution. Loopback and a working directory are not sandboxes. Runtime
checks use fake providers, harmless tools, and isolated temporary state, never
personal data or default live model calls.

## UI primitives

`client/ui/` contains locally owned copies from the
[shadcn Base Nova registry](https://ui.shadcn.com/r/styles/base-nova/), backed by
Base UI. Current sources: [Button](https://ui.shadcn.com/r/styles/base-nova/button.json)
and [Input](https://ui.shadcn.com/r/styles/base-nova/input.json).

- Features own labels, state, feedback, and product terminology.
- Current divergence is limited to formatting and explicit return annotations.
  Review upstream diffs when updating components, document intentional divergence
  here, and run their browser checks.
- Add primitives only for distinct, reusable interactions. Follow the
  architecture's token, accessibility, and interaction requirements.

## Validation

Run workspace commands from this directory; `README.md` owns their inventory.
Choose focused checks for the affected behavior, then the documented workspace
checks for integration. Keep focused tests beside code, cross-boundary Node tests
in `tests/integration/`, and browser journeys in `tests/e2e/`.

`npm test` runs Node integration tests, not E2E. The negative RPC input check in
`client/lib/api.type-test.ts` runs through typechecking. E2E requires compatible
system Chromium and a free test port; rerun it after Chromium or Playwright
updates.

Root lint and formatting include this workspace, but root `just check` does not
build browser assets or run E2E. Root `just fmt` also formats Emacs files.
Report checks not run and missing prerequisites.

## Maintaining guidance

Correct stale guidance only within authorized scope. Treat user corrections as
candidates, distinguish lasting rules from task-specific instructions, and use
the narrowest existing owner with authorization covering that destination.