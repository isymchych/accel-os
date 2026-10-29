# AI workspace agent guide

Private npm workspace `@accel-os/workspace`: a loopback-only Solid 2/Vite client and Hono/Node
server. The diagnostic screen checks browser-to-server communication.

Root `../../AGENTS.md` governs this workspace. Paths below are relative to `ai/workspace/`.

Keep workspace runtime code independent of repository-internal packages.

## Read before changing

- [DOMAIN.md](DOMAIN.md): behavior, configuration, and lifecycle.
- [ARCHITECTURE.md](ARCHITECTURE.md): source ownership, imports, APIs, runtime, and security.
- [MVP.md](MVP.md): first-release integration requirements and acceptance checks.
- [DESIGN.md](DESIGN.md): presentation and interaction.
- [VISION.md](VISION.md#agreed-mvp-decisions): MVP scope, execution authority, and ownership of
  configuration and credentials.
- [DECISIONS.md](DECISIONS.md): consequential choices and rationale.
- [README.md](README.md): development and check commands.

Read the relevant sections, including architecture security requirements before enabling execution.
Proposals describe direction; implementation requires explicit authorization. Runtime checks must
use fake providers, harmless tools, and isolated temporary state.

Consult Pi Durable's examples when useful for feature design and runtime integration. Adapt patterns
to the workspace's agreed requirements and verify APIs against the pinned dependency version.

## Code ownership

Follow the [source layout and dependency rules](ARCHITECTURE.md#source-layout). Features own product
policy; `lib/` and `ui/` stay domain-free. Add feature subdivisions for distinct responsibilities.
Keep server syntax erasable for Node; Vite compiles the browser.

## UI primitives

Use small, locally owned Solid components over native HTML controls, styled through semantic
`client/styles/theme.css` tokens. Features own labels, values, state, feedback, and terminology.
Button and Input forward native attributes/events; native elements own interaction behavior.

Read reactive values through the props object. Use Solid 2 APIs and native HTML attribute names.
Prefer platform capabilities and add primitives for distinct reusable interactions.

When adding shared components, consult relevant documentation, source, and interaction tests from
the [frontend references](ARCHITECTURE.md#frontend-references). Follow their adaptation and
compatibility guidance.

## Validation

Run commands from this directory. Choose focused checks, then the workspace checks in
[README.md](README.md#checks) for integration. Keep focused tests beside code, cross-boundary Node
tests in `tests/integration/`, and browser journeys in `tests/e2e/`.

`npm test` runs Node integration tests; `just test-e2e` runs browser journeys. Typechecking checks
invalid RPC input in `client/lib/api.type-test.ts`. E2E needs compatible system Chromium and a free
port; rerun after Chromium or Playwright updates.

Root lint/formatting includes this workspace. Run the browser build and E2E alongside root
`just check`; root `just fmt` also formats Emacs files. Report missing prerequisites and
verification gaps.

## Maintaining guidance

Correct guidance only within authorized scope. Treat user corrections as candidates for lasting
rules that need evaluation before becoming general policy. Keep lasting guidance in its narrowest
existing owner, with authorization covering that destination.