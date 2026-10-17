# AI workspace agent guide

Private npm workspace `@accel-os/workspace`: a loopback-only Solid 2/Vite client and Hono/Node
server. The diagnostic screen verifies browser-to-server communication.

Root `../../AGENTS.md` governs this workspace. Paths below are relative to `ai/workspace/`.

## Ownership and navigation

| Path                                    | Owner                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| `client/app/`                           | Browser bootstrap, navigation, and composition              |
| `client/ui/`, `client/styles/theme.css` | Domain-free primitives and semantic theme tokens            |
| `client/lib/`                           | Browser infrastructure and Hono RPC transport               |
| `server/app/`                           | Startup, shutdown, HTTP guards, assets, and API composition |
| `contracts/`                            | Environment-neutral TypeBox wire schemas and derived types  |
| `tests/integration/`, `tests/e2e/`      | Cross-boundary Node checks and browser journeys             |

Features own product policy; `lib/` and `ui/` remain domain-free. Add feature subdirectories for
concrete feature responsibilities.

Client code must not import server implementation values or Node-only modules; server code must not
import client code. The intentional Hono RPC type-only edge is confined to `client/lib/api.ts`. Keep
server syntax erasable for Node's native TypeScript execution; Vite owns browser compilation.

## Read before changing

- `README.md`: development, startup, configuration, and check commands.
- `ARCHITECTURE.md`: canonical architecture requirements. Read ownership and boundary validation for
  structural/API changes; runtime and persistence for integration changes; transport and recovery
  for submission/stream changes; frontend design for UI changes; security before enabling execution.
- `DESIGN.md`: visual direction and [motion guidance](DESIGN.md#motion) for UI changes.
- `DECISIONS.md`: consequential choices, including system Chromium for E2E.

Treat architecture proposals as design direction. Resolve initial product scope and execution
authority before real user interactions and tool execution. Loopback binding and working-directory
selection provide network and execution context; sandboxing requires a separate isolation boundary.
Run runtime checks exclusively with fake providers, harmless tools, and isolated temporary state.

## UI primitives

`client/ui/` contains small, locally owned Solid components over native HTML controls. Styling uses
the semantic tokens in `client/styles/theme.css`.

- Features own labels, state, feedback, and product terminology.
- Prefer native web platform capabilities where feasible.
- Button and Input forward native attributes and events. Features provide labels and control values;
  native elements own interaction behavior.
- Read reactive values through their props object. Use Solid 2 APIs and native HTML attribute names.
- Add primitives only for distinct, reusable interactions. Follow the architecture's token and
  interaction requirements.

### Component references

Consult relevant component documentation, source, and interaction tests when adding shared
components:

- [Kobalte](https://github.com/kobaltedev/kobalte): primary reference for Solid component patterns
  and primitive composition.
- [Base UI](https://github.com/mui/base-ui): primary reference for component composition,
  interaction behavior, and state management.
- [React Aria](https://react-aria.adobe.com/): input-interaction patterns.
- [Corvu](https://corvu.dev/): overlays and resizable panels.
- [Zag](https://zagjs.com/): explicit states and transitions for complex controls.

Adapt relevant behavior to Solid 2, local ownership boundaries, and semantic theme tokens. Verify
compatibility when reusing source.

## Validation

Run workspace commands from this directory; `README.md` owns their inventory. Choose focused checks
for the affected behavior, then the documented workspace checks for integration. Keep focused tests
beside code, cross-boundary Node tests in `tests/integration/`, and browser journeys in
`tests/e2e/`.

`npm test` runs Node integration tests; `just test-e2e` runs browser journeys. Typechecking verifies
invalid RPC input rejection in `client/lib/api.type-test.ts`. E2E requires compatible system
Chromium and a free test port; rerun it after Chromium or Playwright updates.

Root lint and formatting include this workspace. Run the browser build and E2E alongside root
`just check`. Root `just fmt` also formats Emacs files. Report verification gaps and required
prerequisites.

## Maintaining guidance

Correct stale guidance only within authorized scope. Treat user corrections as candidates,
distinguish lasting rules from task-specific instructions, and use the narrowest existing owner with
authorization covering that destination.