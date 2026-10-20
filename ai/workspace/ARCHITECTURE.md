# AI workspace architecture

Status: draft. Architecture direction agreed; product scope and integration details remain proposals
where marked.

## Technical direction

Agreed direction:

- Localhost-only deployment initially.
- Separate frontend and backend source trees, with feature slices inside each.
- One private npm package initially, with separate TypeScript configurations for client, server, and
  contracts.
- TypeScript 7, Node, Vite, Oxlint with tsgolint, and Oxfmt.
- Hono and TypeBox for the backend; Hono RPC for browser HTTP calls.
- Solid 2, Tailwind v4, and locally owned native-control primitives with semantic theme tokens.
- Hono RPC for reads and commands, with feature-owned Solid state for live SSE snapshots. Add
  routing for navigation across multiple screens.
- Playwright through `@playwright/test` for end-to-end browser tests.
- `@earendil-works/pi-durable` as the intended runtime for interactive coding and future agentic
  workflows, subject to a bounded integration check.
- Versioned JSON validated with TypeBox for application configuration; `pi-durable`'s built-in
  SQLite storage remains authoritative for conversation and execution state.

## Ownership and boundaries

```text
Browser
  Solid feature UI
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

Production uses one loopback HTTP origin for the UI and API. During development, Vite proxies API
and stream requests to the loopback backend. Neither server binds to a public interface.

In the initial deployment, one Node process hosts workspace services and the local agent host.
`server/runtime/` owns the host's session harnesses, storage, and execution environments. Client
connections observe state and issue commands; admitted work belongs to the host. Development
restarts must close the previous storage owner before opening another.

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

Put focused tests beside the code they exercise. Use `tests/integration/` for cross-boundary Node
behavior and `tests/e2e/` for browser journeys. Matching feature names aid navigation; client and
server internals need not mirror each other.

A server feature can begin with `routes.ts` and `service.ts`; a client feature with a screen and its
state module. Add subdivisions only when there is a distinct responsibility. Avoid mandatory
controller/service/repository layers and blanket barrel exports.

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
- Cross-feature calls use narrow, explicit entry points. Resolve orchestration in `app/` when
  neither feature naturally owns it; avoid cycles.
- Keep provider types and Chord state inside `server/runtime/`. Return application-owned results to
  services and routes.
- Shared contracts contain wire schemas and derived types, not a second domain layer.

Hono RPC introduces one intentional type-only edge: `client/lib/api.ts` imports the composed API
type from `server/app/api.ts`. Frontend features use the client module, not backend types directly.

Separate TypeScript configurations do not make that edge an independent compiler boundary: source
imports can pull server declarations and dependencies into the client type graph. Verify this in the
first integration check. If source-based RPC typing defeats the environment boundary, introduce a
narrow generated declaration surface for the API type rather than exposing server source to every
feature. Do not preemptively add an API workspace package.

Enforce import rules mechanically with the installed lint tooling or a focused repository check;
folder naming alone is not enforcement.

### Types and boundary validation

All three TypeScript configurations use strict checking. The client configuration targets browser
APIs, the server configuration targets Node, and contracts require neither environment's globals.
Prefer type-only imports and explicit relative `.ts` extensions where compatible with the toolchain.

Run server TypeScript directly with Node's native type stripping. Keep server syntax erasable and
follow the repository's existing Node TypeScript settings. Vite owns browser compilation and asset
output.

Define TypeBox wire schemas near each feature's external shape in `contracts/`; derive types instead
of maintaining parallel interfaces. Parse external JSON through the repository's canonical
`@accel-os/shared/json` boundary helper where applicable. Hono validation must preserve inferred
input types, not erase them to `unknown` or `any`.

Use one schema for each wire shape. Internal domain results may differ from transport objects;
normalize them explicitly where that distinction matters. Provider-owned nested data remains
permissive for extra fields, while application-owned contracts are explicit.

Expected route failures have explicit JSON responses and status codes. Unexpected failures use one
sanitized error envelope, with detailed diagnostics only in local logs. Account for middleware and
global error responses in the RPC type surface. HTTP failure, submission acceptance, and eventual
run failure are different outcomes.

Validate SSE payloads before they enter trusted client state. Typed HTTP calls do not replace
validation of streamed JSON.

## Runtime, persistence, and lifecycle

### Verified dependency constraints

The upstream durable README marks the API experimental. It documents persistent conversations,
request-ID deduplication, snapshot-based watches, explicit cancellation, tool replay policies, and
built-in SQLite storage. Storage has a single-process owner and no cross-process locking. See [1].

Hono RPC derives types from validated inputs and route responses; global error handlers require
explicit treatment in the type surface. See [2]. Oxlint integrates tsgolint for type-aware linting
rather than requiring a separate lint workflow. See [3].

### Proposed ownership

- `server/runtime/` owns harness startup, shutdown, storage access, watch adaptation, registry
  setup, and execution environments.
- Feature services enforce project association, conversation-configuration permissions, submission
  policy, and the separation of capability availability, conversation selection, and execution
  authority. Features use Durable tools, hooks, and tasks through `server/runtime/`; runtime
  extensions are internal integration, not an application plugin framework.
- Durable storage owns conversation and execution state. Do not maintain a second authoritative
  transcript or run-status table.
- Application JSON owns registered projects, agent presets, and persisted preferences.
- Harness application documents own metadata that must commit with conversation state, including
  each conversation's project association. Reference project IDs from the JSON catalog; do not
  duplicate the catalog inside the harness.
- The client owns drafts, selected views, expanded output, connection status, and command feedback.
  Derive execution and submission state from committed harness snapshots and records, not a second
  persisted state machine or application task scheduler. See [10].
- Credentials remain server-side, supplied through the host's existing credential mechanisms. Do not
  put provider credentials in browser storage or Vite-exposed environment variables.

Pin the runtime to an exact tested version at implementation time. Keep its integration narrow,
without inventing a general-purpose agent-provider interface. Review upgrades for API and
persisted-state compatibility; take a restorable backup before changes that can alter storage.

### Application-facing runtime operations

`server/runtime/` exposes operations to create or reopen sessions, read conversation state, apply
conversation configuration, submit input with a request ID, request cancellation, and watch
committed snapshots. It owns session-harness lookup and returns application-owned results rather
than raw runtime documents. Submission success means durable acceptance, not completion; a
cancellation request does not establish idle.

### Conversation configuration enforcement

Enforce the [configuration safety rules](DOMAIN.md#configuration-safety) in backend feature
services, not only by disabling UI controls. Route submission admission and
conversation-configuration changes through one coordination boundary in `server/runtime/` for the
affected conversation. Order the busy check and configuration commit with submission admission so a
concurrent submit cannot slip between them. Feature services own the policy; runtime operations
uphold that ordering.

Resolve effective conversation configuration into harness-owned application documents rather than
retaining only a reference to mutable application JSON.

The domain rule preserves execution context because upstream resolves some agent/environment choices
at each task phase. Verify that behavior against the pinned runtime; see [1].

### Runtime SQLite persistence

Use the runtime's built-in Node SQLite adapter, `openNodeSqliteStorage` from
`@earendil-works/pi-durable/storage/sqlite/node`, with one database per independent session/harness.
A session's database contains its main conversation, related subagent conversations, and tasks.
Store databases under `sessions/<session-id>.sqlite` in a private user-data directory outside the
repository. Choose and document the exact root location and backup procedure during persistence
implementation. Prevent simultaneous owners of each database before opening its harness; the
mechanism must survive stale-owner recovery without allowing two live owners. SQLite locking does
not replace the harness's single-process ownership requirement.

Keep application configuration files separate from harness-owned databases. One SQLite transaction
represents one runtime commit. Let the harness manage its schema and migrations; application TypeBox
schemas and migrations apply to application configuration, not runtime records. Do not introduce a
parallel transcript/task database or edit runtime tables manually. Provide readable conversation
exports through the application if needed. See [7].

The Node adapter defaults to WAL mode with `synchronous = NORMAL`: commits survive ordinary process
crashes, but the newest may be lost on power or host failure. Verify the pinned adapter's settings
and document the chosen synchronization policy during integration rather than promising durable
acknowledgements across power loss. See [1].

Measure database/WAL growth, memory use, and reopen time with representative streaming and tool
output. If they exceed the workspace's operational budget, investigate supported upstream
maintenance or storage options; do not add application-written runtime pruning.

Back up each session's complete runtime storage while its harness is closed, together with
application configuration. Account for any remaining SQLite WAL files; copying only a live database
file is not a valid backup procedure. Verify restoration into a separate directory using the pinned
runtime version. Closed-harness backup does not create a transaction between configuration and
runtime state.

### Application JSON persistence

Keep configuration in separate files in the private user-data directory:

```text
preferences.json
projects.json
agent-presets.json
```

Each file has its own `schemaVersion`, identifying its persisted shape rather than a mutation
counter. Define each TypeBox schema and derived state type beside its server-side persistence owner.
Persistence schemas are not automatically HTTP contracts; expose only the fields each route needs.

Each feature owns its configuration file's parsing, validation, migrations, and serialized updates.
Keep any shared file-writing mechanics domain-free in `server/lib/`; do not introduce a generic
storage framework. Apply the following requirements to each file:

- Only the backend writes the file. Treat manual edits as offline changes made while the server is
  stopped; live file watching and merging are not part of the initial design.
- Validate persisted JSON before using it, through the canonical JSON boundary helper. A missing
  file may initialize defaults; malformed or schema-invalid files must remain intact and produce an
  actionable error rather than being silently reset.
- Read the version before selecting its schema. Reject unsupported newer versions without
  overwriting the file. Validate supported older shapes, migrate sequentially, and validate the
  current shape before saving. Add historical schemas and migration steps only when an actual schema
  change requires them.
- Serialize the entire read-modify-write operation through the single backend owner, not merely the
  final write. Validate the candidate state before persistence, and acknowledge success only after
  persistence succeeds. A failed save must not publish the candidate as committed in-memory state.
- Write a temporary file in the destination directory and replace the destination by rename; clean
  up failed temporary writes. Define flushing and backup requirements separately rather than
  treating rename as a guarantee against power loss. Preserve a restorable copy before migration.
- Keep credentials out of this file. Project registrations and presets may refer to server-side
  credential sources, not contain their secrets.

Updates across configuration files and harness commits are not one transaction. Keep saved project,
preset, and preference updates independent of conversation admission; resolve the selected project
and preset before admitting work. Missing project references must surface as configuration errors,
not silently select another directory. Deletion and reassignment rules must preserve this invariant.

The JSON approach assumes small, infrequently changed configuration files with one backend writer.
Reconsider it when measured file size or write frequency makes whole-file replacement costly, or
when requirements demand atomic changes across configuration files or application and runtime state.
Do not add a separate configuration database merely to anticipate those conditions.

## Transport, recovery, and security

### Routing and HTTP state

Choose routing for navigation across multiple screens, with typed parameters and validated URL
search state. Route modules under `client/app/routes/` compose feature screens and coordinate
loading; features own product policy. Routes identify the selected project and conversation. Put
state useful for navigation or reload recovery in the URL.

Feature modules own ordinary reads such as project lists and settings; `client/lib/api.ts` supplies
Hono RPC transport. Use Solid state for read results and loading/error feedback. Configure loader
freshness and refresh behavior deliberately when using route loaders. Live conversation snapshots
remain separate from ordinary read state.

Send commands through explicit feature actions using Hono RPC. Solid state owns their pending/error
feedback, drafts, expanded output, and transient interactions. After a successful configuration
change, explicitly refresh affected read data without clearing drafts. Preserve drafts across
recoverable failures independently of read refreshes. Submission retries follow the request-ID rules
below; do not replay non-idempotent actions indiscriminately. A command response or read refresh is
not evidence that a run has finished.

Do not add an external query library or implement a generic replacement initially. Reconsider a
library when independently refreshed data shared across screens, pagination, or repeated
mutation/cache coordination creates concrete complexity. Prefer an established library over
accumulating homemade cache, retry, and invalidation machinery.

### Submission

1. The client creates a request ID for one logical submission.
2. The server validates input and applies feature policy.
3. The runtime durably admits the submission before HTTP success is returned.
4. The client observes committed progress through the stream.

Retain the request ID across ambiguous HTTP failures so retries cannot duplicate admitted input.
Define its scope and reject reuse with different content. Feature services enforce the
[busy-input policy](DOMAIN.md#submission-and-stopping) once confirmed.

### Streaming

Start with SSE carrying complete application-owned conversation snapshots. One feature-owned
subscription holds snapshot and connection state for the active conversation and shares them with
child components. Connect with an initial snapshot, then replace state when a newer snapshot
arrives. The stream exclusively owns the live snapshot; ordinary read refreshes and command
responses update their separate state. The backend remains authoritative.

Use the runtime's committed-state watch rather than a separate event log. Normalize it in
`server/runtime/`; raw runtime documents do not become the public browser protocol.

Bound pending output per connection and coalesce superseded snapshots for slow readers. Dispose the
server watch on disconnect and the client subscription on conversation change or unmount. Reconnect
starts a new stream generation with a fresh snapshot; reject callbacks from superseded connections.
Show stale/disconnected state until a fresh snapshot arrives.

This intentionally favors a simple client over bandwidth efficiency. Full snapshots become
unsuitable when large transcripts or tool output make serialization materially affect responsiveness
or memory. At that point, add bounded transcript paging or application-owned deltas with snapshot
recovery, guided by measurements rather than a speculative replay framework.

### Cancellation and restart

Implement the [domain lifecycle rules](DOMAIN.md#submission-and-stopping) through the runtime:
disconnect disposes observation, explicit Stop requests cancellation, and shutdown closes observers
and runtime resources. Restart recovery waits for registry and execution-environment readiness.
Require evidence for replay-safe tool declarations.

### Failure presentation and boundary diagnostics

Present the harness's existing submission failure reasons/details, tool error results and partial
output, and terminal task outcomes or blocked-work diagnostics. See [10]. Normalize them into
application-owned, browser-safe contracts and link the summary to the relevant submission or tool
result. Preserve the distinct outcomes and fallback behavior in
[Failure meaning](DOMAIN.md#failure-meaning).

Use committed runtime records as the diagnostic source of truth. Do not create a parallel runtime
diagnostic store, copy task history into application JSON, or introduce an observability subsystem
for the first slice.

Local application logs cover failures outside that runtime state: HTTP handling, application JSON
persistence, startup, and stream delivery. Include operation and available
conversation/submission/task identifiers, with sanitized error information. Raw provider exceptions,
credentials, prompts, and tool payloads are not safe browser details or default log content.

### Runtime introspection

Design direction, not an additional MVP requirement: provide read-only, server-authoritative
inspection of available and enabled capabilities, effective conversation configuration, active tasks
and their ownership, pending submissions, and blocked or interrupted work with its reasons.

Normalize inspection results into application-owned contracts in `server/runtime/`; keep raw harness
documents and provider types private. Apply observation permissions and expose only safe fields,
excluding credentials and sensitive configuration. A browser panel and a future agent-callable
inspection tool should use the same inspection service rather than maintain separate runtime views.
Inspection does not grant execution authority.

### Localhost security and execution policy

Loopback deployment avoids remote hosting complexity; it is not a sandbox or a defense against
another local process.

- Bind to explicit loopback addresses and validate accepted hosts and browser origins. Reject
  unrecognized hosts to constrain DNS-rebinding access.
- For browser mutations, require the configured same-origin policy and JSON requests. Do not enable
  wildcard CORS or state-changing GET routes. Keep Vite proxy behavior consistent with those checks.
- Project selection resolves an opaque registered project ID to a server-owned canonical path. HTTP
  clients cannot choose arbitrary execution directories.
- Apply path containment to application file-access endpoints, including traversal and symlink
  handling. These checks do not contain arbitrary shell execution.
- Render agent text and tool output as untrusted content. Disable raw HTML in Markdown and restrict
  link schemes. Do not execute generated content in the UI.
- Keep storage and credentials private to the user and avoid logging secrets or whole prompts by
  default.

Resolve [execution authority](VISION.md#product-decisions-before-the-first-slice) before enabling
host-write and shell tools or implementing approval machinery. A working directory is not filesystem
isolation; host shell access must never be presented as confined to the selected project. Sandboxing
requires a separate execution-boundary design.

## Frontend design

Accessibility is out of scope for this project.

`client/styles/theme.css` owns semantic CSS variables and Tailwind mappings; `@theme` produces
utilities and `@theme inline` references other variables. See [5]. Light/dark themes share token
names; persist any explicit theme override in application preferences, not a separate store.

`client/ui/` owns domain-free primitives and finite, typed size/emphasis variants. Features own
terminology, state, and compositions; promote only shared, domain-free compositions to `ui/`. Keep
imports explicit and add providers, styling engines, or wrappers only for concrete needs. No
separate design-system package, initial global store, or generic plugin system is needed.

Use [DESIGN.md](DESIGN.md) for presentation and interaction requirements and
[AGENTS.md](AGENTS.md#ui-primitives) for Solid component conventions. Import Lucide icons directly
through a Solid 2-compatible integration. See [6]. Validate patterns in working feature screens;
defer a gallery/Storybook until in-project examples no longer suffice.

## Verification

### Integration checks

Use these checks as acceptance criteria for the corresponding capabilities.

1. **Runtime:** with an exact version and temporary SQLite storage, exercise submit, watch, retry,
   Stop, close/reopen, and abrupt-exit recovery. Measure database/WAL growth, memory use, and reopen
   time with representative output. Verify session isolation, single-owner startup per database, the
   selected synchronization policy, and closed-harness backup/restoration of runtime storage and
   application configuration. Process-exit tests do not establish power-loss durability.
2. **Transport:** verify TypeBox/canonical JSON validation through Hono RPC to the Solid client.
   Retain valid/invalid input checks, error narrowing, and browser bundle boundaries as routes
   expand. Simulate a lost submission response: retry must create one input. Verify reconnect
   convergence, cancellation to idle, bounded slow-reader output, observer cleanup, and rejection of
   stale callbacks/late responses. Read refreshes and commands must preserve drafts and the
   stream-owned snapshot.
3. **Security and UI:** reject hostile hosts/origins, traversal, mismatched request IDs, and
   oversized input. Verify safe Markdown, error/disconnection feedback, primitive variants, control
   interactions, dismissal, and long content in feature screens, in both themes and narrow/wide
   views.
4. **Application state:** for each configuration file, verify initialization, round trips,
   invalid-file preservation, newer-version rejection, concurrent mutations, failed-save isolation,
   and explicit missing-project errors. Add historical migration checks when a historical schema
   exists.
5. **Conversation configuration and lifecycle:** verify preset snapshotting, busy guards under
   concurrent submission/conversation-configuration changes, and Stop waiting for confirmed idle.
   Check submission outcomes independently of connection state, continuing runs after tool failure,
   and safe summaries of runtime failures/blocked work. Approval behavior awaits the product
   decision.

Use Node's test runner for server and contracts checks where it suffices. Playwright is the selected
E2E runner; choose any separate component-test tooling only when focused interactive checks require
it. Live model calls are explicit manual smoke checks, not default tests.

### Test isolation and browser coverage

Deterministic tests use fake providers, harmless tools, and isolated temporary state, never the
personal workspace or provider credentials. Each test receives independent state and cleans up its
processes and temporary data; tests must not share a writable runtime directory.

Keep browser journeys under `tests/e2e/` and configuration in `playwright.config.ts`. As runtime
integration is added, exercise the real frontend, Hono routes, SSE transport, and runtime with a
deterministic fake model, isolated application JSON, and isolated SQLite storage.

Use Playwright's local-server support to start the application under test. Readiness checks must
confirm the test instance is ready; do not silently attach to an existing personal server. Supply
independent ports and storage for concurrent server instances, or serialize the suite until
isolation is implemented. See [8].

Start with project selection and conversation navigation, submit-to-stream-to-Stop, reload/reconnect
preserving committed state, and core control interactions. Assert user-visible outcomes through
role/label locators and retrying assertions rather than fixed sleeps or private component state. See
[9]. Keep abrupt-process recovery, malformed persistence, and detailed failure injection in the
focused Node integration suite; E2E complements those tests rather than duplicating every branch.

Keep E2E execution in the workspace `Justfile` and use system Chromium as selected in
[ADR-001](DECISIONS.md#adr-001-use-system-chromium-for-e2e). [README.md](README.md) owns browser
configuration and check commands.

Once the initial provider and credential flow are selected, choose their implementation defaults in
runtime setup. Choose data location, backup and SQLite synchronization policy in persistence, and
request and output limits in transport. Document the choices and their operational limits rather
than treating them as broad product questions. Preserve the security, recovery, and persistence
requirements above. Escalate only if evidence requires a product tradeoff or a change to the agreed
architecture.

The workspace is registered in root npm workspaces and formatter/lint scopes. Preserve
browser-specific lint environments and keep workspace operations, including E2E, in
`ai/workspace/Justfile`; do not add a parallel repository orchestration system.

## Sources

Upstream documentation was checked while drafting. Verify behavior against the exact installed
version before relying on it in code.

1. [Pi Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
2. [Hono RPC guide](https://hono.dev/docs/guides/rpc)
3. [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware)
4. [Solid 2 documentation](https://v2.solidjs.com/)
5. [Tailwind theme variables](https://tailwindcss.com/docs/theme)
6. [Lucide icons](https://lucide.dev/)
7. [Pi Durable specification, SQLite storage](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md#112-sqlite)
8. [Playwright local web servers](https://playwright.dev/docs/test-webserver)
9. [Playwright best practices](https://playwright.dev/docs/best-practices)
10. [Pi Durable specification, submission and task outcomes](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)