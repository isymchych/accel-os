# AI workspace architecture

Status: draft. Architecture direction agreed; product scope and integration details remain proposals where marked.

Current implementation: a diagnostic connectivity screen, typed HTTP transport,
loopback server guards, and browser checks. Runtime integration, persistence,
and SSE remain unimplemented. See [README.md](README.md) for operation and
[AGENTS.md](AGENTS.md) for development guidance.

Consequential tradeoffs are recorded in [DECISIONS.md](DECISIONS.md).

## Direction and scope

Build a lightweight local web workspace for interacting with AI agents. Optimize for explicit ownership, useful types, low cognitive load, and long-term maintainability by humans and coding agents.

Agreed direction:

- Localhost-only deployment initially.
- Separate frontend and backend source trees, with feature slices inside each.
- One private npm package initially, with separate TypeScript configurations for client, server, and contracts.
- TypeScript 7, Node, Vite, Oxlint with tsgolint, and Oxfmt.
- Hono and TypeBox for the backend; Hono RPC for browser HTTP calls.
- React, Tailwind v4, a locally owned frontend design system with shadcn-derived primitives and semantic theme tokens, and Lucide icons through `lucide-react`.
- TanStack Router for typed navigation, URL state, and ordinary route data loading; Hono RPC for reads and commands, with feature-owned React state for live SSE snapshots.
- Playwright through `@playwright/test` for end-to-end browser tests.
- `@earendil-works/pi-durable` as the intended runtime, subject to a bounded integration check.
- Versioned JSON validated with TypeBox for application configuration; `pi-durable`'s built-in JSONL storage remains authoritative for conversation and execution state. SQLite is not part of the initial design.

Proposed first product slice: select a local project, create or reopen a conversation, submit input, observe responses and tool activity, stop work, reconnect, and recover after a server restart.

Multi-user hosting, remote access, agent orchestration, plugin loading, embedded terminals, and a separate memory system are deferred. These are not permanent exclusions; add them when a concrete use case establishes their requirements.

## Ownership and boundaries

```text
Browser
  React feature UI
    | HTTP commands and reads via Hono RPC
    | SSE snapshots
    v
Node server
  Hono routes -> feature services -> pi-durable integration
                                     |
                                     v
                            durable local storage
                                     |
                                     v
                          tool execution environment
```

Production uses one loopback HTTP origin for the UI and API. During development, Vite proxies API and stream requests to the loopback backend. Neither server binds to a public interface.

One Node process owns the harness and its storage. Browser connections are observers and command clients, not owners of running work. Development restarts must close the previous storage owner before opening another.

### Source layout

The tree illustrates ownership, not a requirement to scaffold empty directories.

```text
client/
  app/                         # Bootstrap, navigation, composition
    routes/                    # Thin route modules; screens stay in features
  features/                    # Conversations, projects, agent settings
  ui/                          # Domain-free design-system primitives
  lib/                         # API client and browser infrastructure
  styles/theme.css             # Semantic tokens and Tailwind mapping
server/
  app/                         # Startup, API composition, shutdown
  features/                    # Product services and routes
  runtime/                     # Harness, persistence, environments
  lib/                         # HTTP and server infrastructure
contracts/                     # Feature wire schemas and derived types
tests/integration/             # Cross-boundary Node tests
tests/e2e/                     # Playwright user journeys
```

Put focused tests beside the code they exercise. Use `tests/integration/` for cross-boundary Node behavior and `tests/e2e/` for browser journeys. Matching feature names aid navigation; client and server internals need not mirror each other.

A server feature can begin with `routes.ts` and `service.ts`; a client feature with a screen and its state module. Add subdivisions only when there is a distinct responsibility. Avoid mandatory controller/service/repository layers and blanket barrel exports.

### Dependency rules

```text
client -> contracts <- server
                      server features -> runtime
```

- Each `app/` composes its environment's features and infrastructure.
- Client code cannot import server implementation values or Node-only modules.
- Server code cannot import client code.
- Contracts depend on environment-neutral schema code, not either application's internals.
- Features own domain behavior. `lib/` and `ui/` contain no feature-specific policy.
- Cross-feature calls use narrow, explicit entry points. Resolve orchestration in `app/` when neither feature naturally owns it; avoid cycles.
- Keep provider types and Chord state inside `server/runtime/`. Return application-owned results to services and routes.
- Shared contracts contain wire schemas and derived types, not a second domain layer.

Hono RPC introduces one intentional type-only edge: `client/lib/api.ts` imports the composed API type from `server/app/api.ts`. Frontend features use the client module, not backend types directly.

Separate TypeScript configurations do not make that edge an independent compiler boundary: source imports can pull server declarations and dependencies into the client type graph. Verify this in the first integration check. If source-based RPC typing defeats the environment boundary, introduce a narrow generated declaration surface for the API type rather than exposing server source to every feature. Do not preemptively add an API workspace package.

Enforce import rules mechanically with the installed lint tooling or a focused repository check; folder naming alone is not enforcement.

### Types and boundary validation

All three TypeScript configurations use strict checking. The client configuration targets browser APIs, the server configuration targets Node, and contracts require neither environment's globals. Prefer type-only imports and explicit relative `.ts` extensions where compatible with the toolchain.

Run server TypeScript directly with Node's native type stripping. Keep server syntax erasable and follow the repository's existing Node TypeScript settings. Vite owns browser compilation and asset output.

Define TypeBox wire schemas near each feature's external shape in `contracts/`; derive types instead of maintaining parallel interfaces. Parse external JSON through the repository's canonical `@accel-os/shared/json` boundary helper where applicable. Hono validation must preserve inferred input types, not erase them to `unknown` or `any`.

Use one schema for each wire shape. Internal domain results may differ from transport objects; normalize them explicitly where that distinction matters. Provider-owned nested data remains permissive for extra fields, while application-owned contracts are explicit.

Expected route failures have explicit JSON responses and status codes. Unexpected failures use one sanitized error envelope, with detailed diagnostics only in local logs. Account for middleware and global error responses in the RPC type surface. HTTP failure, submission acceptance, and eventual run failure are different outcomes.

Validate SSE payloads before they enter trusted client state. Typed HTTP calls do not replace validation of streamed JSON.

## Runtime, persistence, and lifecycle

### Domain model

| Concept       | Meaning and owner                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project       | Application-owned registration identifying a canonical execution directory. A project is not a running agent.                                                                                       |
| Agent preset  | Application-owned reusable model, instructions, tool selection, and execution configuration. Applying a preset resolves concrete conversation configuration; a preset is not a live agent instance. |
| Conversation  | Harness-owned durable transcript and associated documents, identified by its runtime ID and linked to a registered project.                                                                         |
| Submission    | Harness-owned record of admitted input or a write. The first slice exposes user input, with a request ID for retry deduplication.                                                                   |
| Run           | The sequence of model turns and tool calls from admitted input toward a final answer; not a separate application job record.                                                                        |
| Turn and task | A turn is a model response and its tool calls. Durable tasks checkpoint generation/tool work and provide execution diagnostics.                                                                     |

The runtime concepts follow the upstream definitions; application projects and presets are separate configuration concepts. See [1]. Preserve runtime IDs in application references rather than identifying a conversation by its current route or display title.

Keep these dimensions independent:

| Dimension          | Presentation contract                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution activity | Derive idle/running from committed harness state. Show stopping while an explicit Stop request is pending; do not treat the request as confirmation of idle. Surface blocked work explicitly, not as normal progress. |
| Submission outcome | Pending while unsettled, answered when the runtime reports `done`, and unanswered with its reason when it reports `unanswered`. Cancellation is a reason, not an ordinary provider failure.                           |
| Browser connection | Connecting, connected, or disconnected; this describes observation, not whether work exists. Disconnected execution information is last observed, not current confirmation.                                           |

The labels are application presentation, not a new persisted state machine. Derive execution and submission state from harness snapshots and records; retain only transient connection and command feedback in client state. Runtime submission records distinguish unsettled and terminal outcomes. See [13].

An input moves from admission to pending and then an answered/unanswered outcome. A run can finish while the browser is disconnected, and a tool can fail while its run continues. Changing the route detaches observation, not execution. No application-owned transcript, run-status table, or task scheduler is introduced.

### Verified dependency constraints

The upstream durable README marks the API experimental. It documents persistent conversations, request-ID deduplication, snapshot-based watches, explicit cancellation, tool replay policies, and built-in JSONL storage. Storage has a single-process owner and no cross-process locking. See [1].

Hono RPC derives types from validated inputs and route responses; global error handlers require explicit treatment in the type surface. See [2]. Oxlint integrates tsgolint for type-aware linting rather than requiring a separate lint workflow. See [3].

### Proposed ownership

- `server/runtime/` owns harness startup, shutdown, storage access, watch adaptation, registry setup, and execution environments.
- Feature services own product rules such as project association, configuration permissions, and submission policy.
- Durable storage owns conversation and execution state. Do not maintain a second authoritative transcript or run-status table.
- Application JSON owns registered projects, agent presets, and persisted preferences.
- Harness application documents own metadata that must commit with conversation state, including each conversation's project association. Reference project IDs from the JSON catalog; do not duplicate the catalog inside the harness.
- The client owns drafts, selected views, expanded output, and connection status. Server snapshots own persisted conversation and run state.
- Credentials remain server-side, supplied through the host's existing credential mechanisms. Do not put provider credentials in browser storage or Vite-exposed environment variables.

Pin the runtime to an exact tested version at implementation time. Keep its integration narrow, without inventing a general-purpose agent-provider interface. Review upgrades for API and persisted-state compatibility; take a restorable backup before changes that can alter storage.

### Configuration safety

Resolve a selected preset into concrete conversation configuration when it is applied. Later preset edits affect future applications, not conversations already configured from that preset. Store the effective configuration in the harness-owned conversation documents, not merely a reference to mutable application JSON.

Reject changes to a busy conversation's model, instructions, tools/extensions, and working directory. Enforce this on the backend, not only by disabling UI controls. Order the busy check and configuration change with submission admission so a concurrent submit cannot slip between the check and the change. Stop does not unlock configuration until the harness confirms idle.

Do not hot-reload host defaults or registry definitions that alter affected busy conversations. Resolve inherited execution choices explicitly where needed to uphold the same rule. Changing a registered project's path must not silently retarget a configured conversation; applying the new execution directory is an explicit idle-only change.

This constraint is intentional: upstream resolves some agent/environment choices at each task phase, so changing a working directory or extension can affect tool calls already requested by the model. See [1]. It prevents work prepared for one project or tool policy from executing under another. Idle-time reconfiguration is supported; live reconfiguration needs a separate, explicit product requirement.

### Runtime JSONL persistence

Use the runtime's built-in Node JSONL adapter, `openNodeJsonlStorage` from `@earendil-works/pi-durable/storage/jsonl/node`, in a private user-data directory outside the repository. Choose and document the exact location and backup procedure during persistence implementation. Prevent simultaneous storage owners before opening the harness; the mechanism must survive stale-owner recovery without allowing two live owners.

Keep `app-state.json` separate from the harness-owned runtime directory. The upstream JSONL specification describes a main commit log, document/task sidecars, and a commit-marker publication protocol; this is not merely an editable conversation transcript. See [8].

Let the harness manage runtime files and their format. Application TypeBox schemas and migrations apply to application configuration, not runtime records. Do not implement a custom transactional file store or edit runtime files manually. Provide readable conversation exports through the application if needed.

The specification documents ordinary process-crash consistency, not guaranteed power-loss durability. Its `fsync` option flushes affected sidecars before the main marker, but ordinary publication does not explicitly flush that marker; even an acknowledged tail commit may disappear after host failure. See [8]. Choose the flushing policy during the integration check and document this limit rather than promising durable acknowledgements across power loss.

The specification says the main log is not initially compacted. See [8]. Measure directory growth and reopen time with representative streaming and tool output. If either exceeds the workspace's operational budget, investigate supported upstream maintenance or storage options; do not truncate or compact runtime logs with application-written tooling.

Back up the complete runtime directory while the harness is closed, together with application configuration. Verify restoration into a separate directory using the pinned runtime version. Closed-harness backup avoids copying a partially published multi-file commit; it does not create a transaction between configuration and runtime state.

### Application JSON persistence

Start with one small `app-state.json` in the private user-data directory:

```json
{
  "schemaVersion": 1,
  "projects": [],
  "agentPresets": [],
  "preferences": {}
}
```

`schemaVersion` identifies the persisted shape, not a mutation counter. Define the TypeBox schema and derived state type beside their server-side persistence owner. Persistence schemas are not automatically HTTP contracts; expose only the fields each route needs.

Feature services apply product rules through one concrete application-state module. That module owns parsing, validation, migrations, and file replacement. Keep it in `server/lib/`; do not introduce a generic storage framework or separate files per feature without a concrete need.

- Only the backend writes the file. Treat manual edits as offline changes made while the server is stopped; live file watching and merging are not part of the initial design.
- Validate persisted JSON before using it, through the canonical JSON boundary helper. A missing file may initialize defaults; malformed or schema-invalid files must remain intact and produce an actionable error rather than being silently reset.
- Read the version before selecting its schema. Reject unsupported newer versions without overwriting the file. Validate supported older shapes, migrate sequentially, and validate the current shape before saving. Add historical schemas and migration steps only when an actual schema change requires them.
- Serialize the entire read-modify-write operation through the single backend owner, not merely the final write. Validate the candidate state before persistence, and acknowledge success only after persistence succeeds. A failed save must not publish the candidate as committed in-memory state.
- Write a temporary file in the destination directory and replace the destination by rename; clean up failed temporary writes. Define flushing and backup requirements separately rather than treating rename as a guarantee against power loss. Preserve a restorable copy before migration.
- Keep credentials out of this file. Project registrations and presets may refer to server-side credential sources, not contain their secrets.

Application JSON updates and harness commits are not one transaction. Keep configuration changes independent of conversation admission; resolve the selected project and preset before admitting work. Missing project references must surface as configuration errors, not silently select another directory. Deletion and reassignment rules must preserve this invariant.

The JSON approach assumes small, infrequently changed configuration with one writer. Reconsider it when measured file size or write frequency makes whole-file replacement costly, or when requirements demand atomic changes across application and runtime state. Do not add a second database merely to anticipate those conditions.

## Transport, recovery, and security

### Routing and HTTP state

Use TanStack Router for typed navigation, route parameters, and validated URL search state. Keep route modules under `client/app/routes/` thin: they compose feature screens and coordinate loading, not own feature policy. Routes identify the selected project and conversation; only state useful for navigation or reload recovery belongs in the URL. File-based versus code-based route declaration can be chosen during setup without changing feature ownership. See [9].

Use Router loaders and their built-in loading/error and caching behavior for ordinary reads such as project lists and settings. Feature modules own the read functions; `client/lib/api.ts` supplies Hono RPC transport. Configure loader freshness and refresh behavior deliberately. Live conversation snapshots do not belong in the loader cache. See [10].

Send commands through explicit feature actions using Hono RPC. React state owns their pending/error feedback, drafts, expanded output, and transient interactions. After a successful configuration change, explicitly refresh affected route data without clearing drafts. Preserve drafts across recoverable failures independently of route refreshes. Submission retries follow the request-ID rules below; do not replay non-idempotent actions indiscriminately. A command response or route refresh is not evidence that a run has finished.

Do not add an external query library or implement a generic replacement initially. Reconsider a library when independently refreshed data shared across screens, pagination, or repeated mutation/cache coordination creates concrete complexity. Prefer an established library over accumulating homemade cache, retry, and invalidation machinery.

### Submission

1. The client creates a request ID for one logical submission.
2. The server validates input and applies feature policy.
3. The runtime durably admits the submission before HTTP success is returned.
4. The client observes committed progress through the stream.

An ambiguous HTTP failure does not prove that admission failed. Retry the same logical submission with the same request ID. A newly composed input gets a new ID. Define the request-ID scope and reject reuse with different content, rather than silently accepting a mismatched retry.

Proposed first busy policy: reject new input while a conversation is busy. Do not silently queue or steer. Revisit this when the UI explicitly supports follow-up or steering semantics.

### Streaming

Start with SSE carrying complete application-owned conversation snapshots. One feature-owned subscription holds snapshot and connection state for the active conversation and shares them with child components; do not open a subscription per consumer. Connect with an initial snapshot, then replace state when a newer snapshot arrives. No initial HTTP snapshot or HTTP-to-stream cache handoff is required. Router loader results and command responses must not overwrite this live snapshot. The backend remains authoritative.

Use the runtime's committed-state watch rather than a separate event log. Normalize it in `server/runtime/`; raw runtime documents do not become the public browser protocol.

Bound pending output per connection and coalesce superseded snapshots for slow readers. Dispose the server watch on disconnect and the client subscription on conversation change or unmount. Reconnect starts a new stream generation with a fresh snapshot; reject callbacks from superseded connections. Show stale/disconnected state until a fresh snapshot arrives; do not mark the agent idle merely because transport failed.

This intentionally favors a simple client over bandwidth efficiency. Full snapshots become unsuitable when large transcripts or tool output make serialization materially affect responsiveness or memory. At that point, add bounded transcript paging or application-owned deltas with snapshot recovery, guided by measurements rather than a speculative replay framework.

### Cancellation and restart

- Closing a tab or aborting an HTTP wait detaches that client; it does not stop admitted work.
- Stop is an explicit command. Show stopping until the runtime confirms the conversation has become idle.
- Proposed Stop semantics include cancellation of the active run and its owned foreground work. Background work is deferred until its cancellation policy is designed.
- Graceful server shutdown closes observers and runtime resources; it is not a user Stop action.
- Restart resumes eligible pending work after registry and execution environments are ready. Unavailable definitions or credentials produce visible diagnostics rather than indefinite apparent activity.
- Recovery never means exactly-once external side effects. Replay-safe declarations require evidence; interrupted unsafe tools must be surfaced for review instead of blindly rerun.

### Failure presentation and boundary diagnostics

Present the harness's existing submission failure reasons/details, tool error results and partial output, and terminal task outcomes or blocked-work diagnostics. See [13]. Normalize them into application-owned, browser-safe contracts and link the summary to the relevant submission or tool result. A user should understand why input went unanswered or work is blocked without inspecting the entire transcript.

Distinguish provider failure, tool failure, interrupted execution, invalid/unavailable configuration, and browser transport failure. Do not mark an entire run failed merely because one tool returned an error; execution may continue. Preserve cancellation as an explicit outcome. Show a useful fallback for unfamiliar runtime reasons rather than discarding the failure or claiming success.

Use committed runtime records as the diagnostic source of truth. Do not create a parallel runtime diagnostic store, copy task history into application JSON, or introduce an observability subsystem for the first slice.

Local application logs cover failures outside that runtime state: HTTP handling, application JSON persistence, startup, and stream delivery. Include operation and available conversation/submission/task identifiers, with sanitized error information. Raw provider exceptions, credentials, prompts, and tool payloads are not safe browser details or default log content. Losing the stream is a connection error, not evidence of execution failure.

### Localhost security and execution policy

Loopback deployment avoids remote hosting complexity; it is not a sandbox or a defense against another local process.

- Bind to explicit loopback addresses and validate accepted hosts and browser origins. Reject unrecognized hosts to constrain DNS-rebinding access.
- For browser mutations, require the configured same-origin policy and JSON requests. Do not enable wildcard CORS or state-changing GET routes. Keep Vite proxy behavior consistent with those checks.
- Project selection resolves an opaque registered project ID to a server-owned canonical path. HTTP clients cannot choose arbitrary execution directories.
- Apply path containment to application file-access endpoints, including traversal and symlink handling. These checks do not contain arbitrary shell execution.
- Render agent text and tool output as untrusted content. Disable raw HTML in Markdown and restrict link schemes. Do not execute generated content in the UI.
- Keep storage and credentials private to the user and avoid logging secrets or whole prompts by default.

Tool permissions and approvals are unresolved product decisions. No approval mechanism, persistence model, or approval semantics are selected. Whether approvals are needed, which actions they cover, and their scope, rejection, disconnect, and restart behavior remain questions for the execution-authority decision; do not implement that machinery before the decision. Until a host-write and shell policy is agreed, the first integration check uses a fake model and harmless tools. A working directory is not filesystem isolation; host shell access must never be presented as confined to the selected project. Adding real sandboxing requires a separate execution-boundary design.

## Frontend design and accessibility

The local design system owns tokens, domain-free primitives, and usage contracts, not a separate package or generic framework. Features own terminology, domain state, and compositions; promote a composition to `ui/` only when domain-free and shared.

### Direction and ownership

Use clear hierarchy, readable conversations/code, familiar controls, and restrained emphasis. Establish palette, typography, and density using representative conversation/settings content in the first UI slice.

`client/styles/theme.css` owns design values and Tailwind mapping; `client/ui/` owns adopted shadcn components needed by implemented slices. [AGENTS.md](AGENTS.md#ui-primitives) owns baseline, sources, and divergence records. Keep imports explicit; add providers, styling engines, or native-element wrappers only for a concrete responsibility.

### Tokens and theming

Define semantic CSS variables and Tailwind tokens centrally: `@theme` produces utilities; `@theme inline` references other variables. Use compatible shadcn conventions. See [6] and [7].

- **Color:** surface/text pairs, primary action, muted content, border/input, destructive action, and focus-ring roles. Retain compatible shadcn names where practical; avoid duplicate aliases, scattered raw colors, and feature palettes.
- **Typography:** body/UI and monospace roles, a small hierarchy, readable line heights, and initial system font stacks; external fonts are optional.
- **Sizing:** use Tailwind's scale; centralize shared control/icon sizes without aliasing every spacing utility.
- **Shape:** a small radius/shadow vocabulary; elevation signifies layering.
- **Motion:** short, purposeful transitions and reduced-motion support; access and correctness never depend on animation completion.

Light/dark themes share token names and default to system preference. Persist any explicit override in application preferences, not another store. Check contrast and interactive states independently in both themes.

### Primitives and states

Begin with needed buttons, inputs/textarea, labeled fields, and feedback; add dialogs, menus, tooltips, and other primitives only for required interactions. Size/emphasis variants are finite and typed; features must not restyle primitives into conflicting variants.

Document each primitive's accessible-name, focus, and controlled-state ownership. Cover applicable loading, empty, error, disabled, permission, success, and overflow states; empty/error feedback explains the next useful action. Follow lifecycle/transport rules for execution, connection, and drafts. Keep feature state and public entry points explicit, without an initial global store or generic plugin system.

### Icons

Import `lucide-react` icons directly where used; no string registry or custom abstraction for static icons. See [4]. Use consistent sizing, strokes, semantic foregrounds, and meanings across features. Icon dimensions do not define target size. Label icon-only buttons on the button; hide decorative icons from assistive technology. Tooltips do not replace accessible names. Pair unfamiliar or consequential actions with visible text. See [5].

### Accessibility and acceptance

Acceptance requires semantic, labeled, keyboard-operable controls, visible focus, adequate contrast, and reduced-motion support. Check dialog initial focus, containment, dismissal, and return to the invoking control. Associate field errors with inputs; errors and connection status cannot rely on color alone.

Streaming preserves scroll/focus intent without announcing every token. Long paths, model names, code, and tool output must not hide primary actions. Check representative narrow/wide views and text resizing.

Inspect representative controls/states in the first working screen before spreading patterns. Use focused interaction tests and manual rendered checks for hierarchy, density, themes, and keyboard flows; automated audits complement, not replace, them. Defer a gallery/Storybook until in-project examples no longer suffice.

## Remaining checks and product decisions

### Integration checks

These are acceptance obligations, not a record of checks executed. The current
foundation includes diagnostic API/server tests, an RPC input type test, and
browser checks; runtime-dependent checks remain future work.

1. **Runtime compatibility check:** use an exact runtime version, fake provider, and temporary built-in JSONL storage. Demonstrate submit, watch, request-ID retry, stop, close/reopen, and recovery of pending work after an abrupt process exit. Establish a safe single-owner startup mechanism. Measure directory growth and reopen time with representative streaming/tool output; select the flushing policy and document process-crash versus host-failure durability limits. Verify closed-harness backup and restoration of the complete runtime directory and application configuration. Process-exit tests do not establish power-loss durability.
2. **Typed transport:** the diagnostic route connects TypeBox/canonical JSON validation to Hono RPC and the React client, with valid/invalid input type checks. As routes and runtime integration expand, verify error narrowing and that server implementation values cannot enter the browser bundle; decide whether RPC typing needs a declaration boundary. Retain validation compatibility and input type checks.
3. **Conversation slice:** exercise submission and SSE together. A simulated lost HTTP response followed by retry creates one input. Disconnect/reconnect converges to server state, cancellation reaches idle, slow readers have bounded pending output, and stale connection callbacks or late HTTP responses cannot overwrite current state. Verify loader revalidation and command responses cannot overwrite the streamed snapshot, and conversation changes dispose the old subscription without duplicating observers. Configuration changes refresh affected route data without clearing drafts or live conversation state.
4. **Security and UI checks:** reject hostile hosts/origins, traversal, mismatched request IDs, and oversized inputs. Verify safe Markdown and observable error/disconnection states. Exercise primitive variants, icon-only accessible names, keyboard flows, dialog focus, reduced motion, long content, and text resizing; inspect representative narrow/wide views in both themes. These checks validate the design system in feature compositions, not only isolated controls.
5. **Application-state persistence:** temporary-file tests cover missing-file initialization, round-trip persistence, invalid-file preservation, newer-version rejection, concurrent mutations without lost updates, and failed saves without publishing uncommitted state. Add migration tests when a historical version exists. Verify missing project references fail explicitly instead of selecting a fallback directory.
6. **Configuration and lifecycle:** prove preset edits do not change configured conversations, busy-time execution changes are rejected, and concurrent submission/configuration requests cannot bypass the busy guard. Verify Stop does not unlock configuration prematurely. Exercise pending-to-answered/unanswered transitions independently of connection state; tool failure can remain visible while execution continues. Existing runtime reasons and blocked-work diagnostics produce sanitized, actionable summaries without a second diagnostic store. Approval behavior is not tested or implemented until the product decision is made.

Use Node's test runner for server and contracts checks where it suffices. Playwright is the selected E2E runner; choose any separate component-test tooling only when focused interactive checks require it. Live model calls are explicit manual smoke checks, not default tests.

### Test isolation and browser coverage

Deterministic tests use fake providers, harmless tools, and isolated temporary state, never the personal workspace or provider credentials. Each test receives independent state and cleans up its processes and temporary data; tests must not share a writable runtime directory.

Keep browser journeys under `tests/e2e/` and configuration in `playwright.config.ts`. As runtime integration is added, exercise the real frontend, Hono routes, SSE transport, and runtime with a deterministic fake model, isolated application JSON, and isolated JSONL storage.

Use Playwright's local-server support to start the application under test. Readiness checks must confirm the test instance is ready; do not silently attach to an existing personal server. Supply independent ports and storage for concurrent server instances, or serialize the suite until isolation is implemented. See [11].

Start with project selection and conversation navigation, submit-to-stream-to-Stop, reload/reconnect preserving committed state, and keyboard/icon-only control flows. Assert user-visible outcomes through role/label locators and retrying assertions rather than fixed sleeps or private component state. See [12]. Keep abrupt-process recovery, malformed persistence, and detailed failure injection in the focused Node integration suite; E2E complements those tests rather than duplicating every branch.

Keep E2E execution in the workspace `Justfile` and use system Chromium as selected in [ADR-001](DECISIONS.md#adr-001-use-system-chromium-for-e2e). [README.md](README.md) owns browser configuration and check commands.

Choose engineering defaults within the slice that owns them: initial provider and credential configuration in runtime setup; data location, backup and flushing policy in persistence; request and output limits in transport. Document the choices and their operational limits rather than treating them as broad product questions. Preserve the security, recovery, and persistence requirements above. Escalate only if evidence requires a product tradeoff or a change to the agreed architecture.

The workspace is registered in root npm workspaces and formatter/lint scopes. Preserve browser-specific lint environments and keep workspace operations, including E2E, in `ai/workspace/Justfile`; do not add a parallel repository orchestration system.

### Product decisions before the first slice

Resolve these before implementing real user interactions and tool execution; harmless integration checks can proceed independently:

1. **Initial scope:** confirm project registration and selection, conversation creation and reopening, submission, observation, Stop, reconnect, and restart recovery as the first slice. Additional interactions, including project deletion and reassignment, stay deferred unless explicitly added. If they are added, define how existing conversation references remain valid before implementing them.
2. **Execution authority:** decide whether agents may edit host files and execute shell commands. Approvals remain explicitly undecided: are they needed, for which actions, and with what scope and rejection/disconnect/restart behavior? Select no approval mechanism until those requirements are agreed. If execution must be confined rather than merely rooted in a working directory, define the isolation boundary before enabling those tools. Localhost deployment does not grant tool permissions or provide isolation.

Runtime compatibility, single-owner enforcement, RPC typing, persistence policy, and transport limits are engineering checks under the section above, not additional open product decisions. Do not reopen the agreed localhost deployment and separated-source direction without new requirements or a concrete blocker.

## Sources

Upstream documentation was checked while drafting. Verify behavior against the exact installed version before relying on it in code.

1. [Pi Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
2. [Hono RPC guide](https://hono.dev/docs/guides/rpc)
3. [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware)
4. [Lucide for React](https://lucide.dev/guide/react/)
5. [Lucide React accessibility](https://lucide.dev/guide/react/advanced/accessibility)
6. [Tailwind theme variables](https://tailwindcss.com/docs/theme)
7. [shadcn/ui theming](https://ui.shadcn.com/docs/theming)
8. [Pi Durable specification, JSONL storage](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md#113-jsonl)
9. [TanStack Router type safety](https://tanstack.com/router/latest/docs/guide/type-safety)
10. [TanStack Router data loading](https://tanstack.com/router/latest/docs/guide/data-loading)
11. [Playwright local web servers](https://playwright.dev/docs/test-webserver)
12. [Playwright best practices](https://playwright.dev/docs/best-practices)
13. [Pi Durable specification, submission and task outcomes](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)