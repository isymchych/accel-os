# AI workspace architecture

Draft architecture. The technical direction and MVP scope are agreed. Runtime integration remains
proposed where noted.

## Technical direction

- Loopback-only deployment, with separate client and server source in one private npm package.
- TypeScript 7, Node, Vite, Oxlint with tsgolint, and Oxfmt.
- Solid 2 with TanStack AI's headless `@tanstack/ai-client` through a small local Solid 2 binding,
  Tailwind v4, locally owned components, and semantic theme tokens.
- Hono and TypeBox, with Hono RPC for workspace HTTP reads and commands.
- AG-UI for frontend conversation synchronization over HTTP/SSE, adapted from Pi Durable's committed
  state.
- Pi Durable for conversations and execution, with `pi-ai` for model access and authentication,
  subject to [integration checks](MVP.md#integration-checks).
- Durable's built-in SQLite storage for execution; versioned, TypeBox-validated JSON for application
  configuration.
- Playwright for browser tests.

[DOMAIN.md](DOMAIN.md) owns behavioral rules; [VISION.md](VISION.md#agreed-mvp-decisions) owns MVP
scope and execution authority. This document owns system structure and lasting technical
constraints; [MVP.md](MVP.md) owns first-release integration requirements, open integration
questions, and acceptance checks.

## Ownership and boundaries

```text
Browser: Solid 2 features + local binding to @tanstack/ai-client
  | Hono RPC: workspace reads and commands
  | AG-UI over HTTP/SSE: conversation snapshots and updates
  v
Node: Hono routes -> feature services -> server/runtime/
                                          | Durable harnesses and storage
                                          | pi-ai providers and authentication
                                          | tool execution environments
```

One Node process initially hosts workspace services and the local agent host. Production serves UI
and API from one loopback origin; development uses Vite's proxy for API and stream requests. Both
servers bind exclusively to loopback addresses. Development restarts must close the previous storage
owner before opening another.

The workspace owns presentation, user intent, configuration, credentials, host discovery, and
transport. Local execution works directly with the selected environment. Scheduling and remote
provisioning belong to later scope.

### Source layout

Use this tree to assign ownership; create directories as implementation needs them.

```text
client/
  app/                    # Bootstrap, navigation, composition
    routes/               # Thin routes composing feature screens
  features/               # Product UI and state
  ui/                     # Domain-free primitives
  lib/                    # Browser infrastructure and API client
  styles/theme.css        # Semantic tokens and Tailwind mapping
server/
  app/                    # Startup, API composition, shutdown
  features/               # Product routes and services
  runtime/                # Harnesses, persistence, environments
  lib/                    # Server infrastructure
contracts/                # Environment-neutral wire schemas and derived types
tests/integration/        # Cross-boundary Node checks
tests/e2e/                # Browser journeys
```

Keep focused tests beside their code. Matching feature names help navigation; client and server
internals can evolve independently. Start server features with routes and a service, and client
features with a screen and state. Add subdivisions for distinct responsibilities. Introduce layers
and barrel exports when concrete needs justify them.

### Dependency rules

```text
client -> contracts <- server
                       features -> runtime
```

Each `app/` composes its environment. Features own product policy; `lib/` and `ui/` stay
domain-free. Cross-feature calls use narrow entry points and acyclic dependencies. Put orchestration
in `app/` when its responsibility lies beyond either individual feature.

Client code must not import server implementation values or Node-only modules; server code must not
import client code. Contracts contain environment-neutral wire schemas and depend on schema code.
Keep domain behavior in features and provider types and Chord state inside `server/runtime/`,
returning application-owned results.

The sole Hono RPC type-only edge is `client/lib/api.ts` importing the composed API type from
`server/app/api.ts`. Features use the client module. That import may pull server dependencies into
the client type graph even with separate TypeScript configurations. Verify the boundary during
integration; if source typing defeats it, generate a narrow API declaration surface. Introduce an
API package when a concrete integration need justifies it.

Enforce import boundaries with installed lint tooling or a focused repository check.

### Types and validation

Use strict TypeScript configurations for browser, Node, and environment-neutral contracts. Prefer
type-only imports and explicit relative `.ts` extensions where supported. Server code runs through
Node's native type stripping and follows the repository's erasable-syntax settings; Vite compiles
the browser.

Define one TypeBox schema per application-owned wire shape near its feature in `contracts/` and
derive types from it. Use protocol-defined schemas for AG-UI envelopes and events; application-owned
state carried by the protocol retains its TypeBox schemas. Validate external JSON using the owning
TypeBox schema. Preserve inferred Hono input types through the RPC boundary. Keep provider-owned
nested data permissive for extra fields; application contracts are explicit. Normalize internal
domain results to wire shapes where they differ.

Expected route failures have explicit JSON responses and status codes. Unexpected failures use one
sanitized envelope, with detailed diagnostics confined to local logs. Include middleware and global
errors in RPC typing. HTTP failure, durable acceptance, and eventual run failure are distinct.

Validate AG-UI events and application-owned payloads before they enter trusted client state; stream
validation is separate from Hono RPC typing.

## Runtime, persistence, and lifecycle

### Proposed ownership

- **Runtime integration:** harness startup/shutdown, lookup, storage, watches, registries, and
  execution environments, plus configured `pi-ai` model access.
- **Feature services:** user-selected context, configuration permissions, submission policy, and
  execution authority. Access Durable tools, hooks, and tasks through `server/runtime/`.
- **Durable storage:** single store for transcripts, run status, task scheduling, execution
  diagnostics, and accounting.
- **Application JSON:** account configuration, model defaults, registered projects, and persisted
  preferences. Presets and general provider configuration are post-MVP.
- **Workspace credentials:** server-side authentication material and persistence.
- **Harness application documents:** metadata that must commit with conversation state, including
  resolved configuration and account selection, and optional project association. Keep the project
  catalog in application JSON and reference its IDs from harness documents.
- **Client:** drafts, selected views, expanded output, connection state, and command feedback.
  Execution and submission state come from committed runtime records.

Pin an exact tested Durable version: its API is experimental. Review API and persisted-state
compatibility on upgrades and take a restorable backup before storage-changing upgrades. Keep the
integration narrow and specific to Durable's supported APIs.

### Pi integration

Design features around supported Durable and `pi-ai` capabilities. Durable owns the conversation and
execution lifecycle; `pi-ai` owns provider access, model catalogs, and authentication. Workspace
services own product policy and configuration.

- Delegate context management, compaction, and overflow recovery to Durable.
- Use its submission inbox, committed task graph, and inspection as the queue and status model. Use
  runtime usage records when exposing consumption.
- When workflows or codemode enter scope, prefer Durable's owned tasks, child conversations, sleeps,
  cancellation propagation, and native codemode.
- Use `pi-ai`'s supported OpenAI login and model catalog for MVP. General provider configuration,
  custom endpoints, and additional providers are post-MVP.

Workspace configuration supplies model choices and per-conversation account selection. The workspace
owns its configuration schemas and server-side credential persistence; `pi-ai` supplies
authentication and OAuth refresh behavior. Account credentials and refresh state remain isolated,
allowing conversations using different OpenAI accounts to execute concurrently without a global
active-login switch.

Apply these choices within the [agreed MVP scope](VISION.md#agreed-mvp-decisions). Keep credentials
server-side, out of browser storage and Vite-exposed variables.

### Runtime operations and configuration

Backend feature services enforce [configuration safety](DOMAIN.md#configuration-safety). Coordinate
configuration commits and submission admission through one per-conversation boundary in
`server/runtime/`, so each admitted unit receives a consistent resolved configuration. Persist it in
harness-owned application documents as resolved values.

The [MVP runtime integration](MVP.md#runtime-integration) defines operations and runtime-limited
configuration guards.

Account selection is independent of conversation identity and historical transcript state. Post-MVP
switching applies to subsequent submissions while admitted work retains its resolved account. New
branches use the currently selected account, not the account at the historical fork point. Keep
these choices explicit at the application boundary rather than inheriting historical account
selection from runtime forks.

### Runtime terms and state

Identify conversations by runtime ID; routes and titles provide navigation and presentation. Runtime
terms follow upstream definitions: a conversation owns its durable transcript and associated
documents; a submission records admitted input or a write; a turn is one model response and its tool
calls; a task is a durable checkpointed unit for generation, tools, and execution diagnostics. Use
**run** for the domain concept and **execution** for the general activity.

Derive idle/running and blocked work from committed harness state. Input progresses from admission
to pending, then answered when the runtime reports `done`, or unanswered with its reason when it
reports `unanswered`. Present these states directly from runtime records.

### Capability selection

Select implemented capabilities directly through backend feature services under execution policy.
These services keep availability, conversation selection, and execution authority separate. Runtime
extensions serve internal integration; application plugin loading remains later scope.

### Runtime SQLite persistence

Enforce one process owner per database before opening its harness and throughout stale-owner
recovery. The application must enforce ownership across processes alongside SQLite locking.

Each runtime commit is one SQLite transaction. Let the harness own its schema and migrations.
Application TypeBox schemas and migrations apply only to application configuration. Do not edit
runtime tables manually; provide application-level readable conversation exports if needed.

The [MVP storage contract](MVP.md#runtime-sqlite-persistence) defines the adapter, layout,
synchronization checks, growth measurements, and backup/restore procedure.

### Application JSON persistence

Each feature owns parsing, migrations, and serialized updates. Keep shared file-writing mechanics as
focused helpers in `server/lib/`.

The [MVP JSON contract](MVP.md#application-json-persistence) defines files, versioning, validation,
migrations, and safe writes.

Configuration files and harness commits persist independently. Keep project, account, and preference
updates independent of admission. Resolve the directory, account, and any selected project before
admitting work; direct directory selection works independently of project registration. Missing
project references produce errors while preserving the configured directory. Future deletion and
reassignment must preserve this invariant.

JSON assumes small, infrequently changed files with one backend writer. Reconsider it when
measurements show costly whole-file replacements or requirements call for cross-file/runtime
transactions.

## Commands, snapshots, and lifecycle

AG-UI is the selected frontend conversation protocol, carried over HTTP/SSE. Adapt Durable's
committed conversation state and changes into AG-UI message/state snapshots and incremental message,
tool, and lifecycle events. Pi Durable remains the execution and persistence owner; AG-UI defines
the wire contract, not a second runtime or a UI component library.

Hono RPC carries workspace reads and commands, including history/tree reads, fork commands, and
configuration. Workspace features own branch navigation and product policy. Keep protocol
translation at the server transport boundary, consuming application-owned results from
`server/runtime/`; provider types and Chord state remain inside the runtime boundary. Ordinary
reads, command feedback, and protocol-driven live state have separate client ownership.

Initialize and reconnect with snapshots of current committed state, then apply subsequent updates.
Reconnection does not require replaying every missed streaming event. The
[MVP streaming contract](MVP.md#streaming) owns client synchronization and backpressure
requirements.

The runtime owns admission, follow-up placement, cancellation, and restart recovery. Workspace
integration confirms cancellation of active work and termination of its owned processes.
Queued-input behavior follows the selected runtime under the
[domain lifecycle](DOMAIN.md#work-lifecycle); queue preservation and explicit resumption are not
runtime-selection constraints. Transport disconnects dispose observation while execution continues.
The [MVP command flows](MVP.md#commands-and-live-state) define routing, deduplication, and
streaming; its [recovery contract](MVP.md#recovery-and-cancellation) defines shutdown and startup
integration.

### Failure presentation and inspection

Normalize runtime submission failure reasons/details, tool errors and partial output, terminal task
outcomes, and blocked-work diagnostics into application-owned, browser-safe contracts in
`server/runtime/`. Link summaries to the relevant submission or tool result and preserve the
[distinct failure meanings](DOMAIN.md#activity-outcomes-and-connection).

Runtime storage owns task history. The [MVP conversation activity](MVP.md#conversation-activity)
contract defines conversation-list status indicators and conversation-level inspection, without a
separate work-view screen.

Committed runtime records remain authoritative for execution history, activity, and outcomes; logs
explain operations rather than establish execution truth.

Use Pino for server-side structured JSON logging to stdout, with one configuration owner in
`server/lib/logger.ts`. Local logs cover operational boundaries and failures outside committed
runtime state: HTTP, JSON persistence, startup, and stream delivery. Include event, operation,
available conversation/submission/task IDs, relevant durations, and sanitized error codes. Avoid
per-token, per-snapshot, and routine internal-call logging. Development may use `pino-pretty`;
external transports, a logging service, and a generic logger abstraction are not needed initially.

Select safe fields explicitly before logging; configured redaction is an additional defense, not a
substitute. Exclude raw provider exceptions, credentials, prompts, file contents, shell arguments,
and tool payloads from browser diagnostics and default logs.

## Future host and environment constraints

These constraints apply when the [longer-term direction](VISION.md#longer-term-direction) enters
scope.

A constellation consists of registered hosts with explicit observation and control permissions. Host
identity stays stable across connections and restarts. Scheduling, spawning agents, and provisioning
need separately defined permissions.

Provisioning a host and joining an existing one are distinct operations. Cloud provisioning,
suspension, and wake-up belong to environment lifecycle management. Conversation identity and
durable state survive suspension; retained artifacts need an explicit persistence policy. Waking
compute requires an external mechanism. Background work requires a defined cancellation policy
before entering scope.

An agent identity spanning conversations, such as a named scheduled maintenance agent, would justify
a separate agent entity.

Iroh remains a transport candidate awaiting a selection decision. Browser, mobile, edge, and IoT
hosts need platform-specific runtime and storage assessment.

## Security and execution policy

Loopback simplifies hosting; local processes remain a security risk. The
[MVP execution policy](VISION.md#agreed-mvp-decisions) is unsandboxed; never describe shell access
as confined to the working directory. Sandboxing needs a separate execution-boundary design.

- Bind to explicit loopback addresses. Validate hosts and browser origins; reject unrecognized hosts
  to constrain DNS rebinding.
- Require configured same-origin checks and JSON for browser mutations. No wildcard CORS or
  state-changing GET routes. Keep Vite proxy behavior consistent.
- Accept a directory or opaque saved-project ID. Validate and canonicalize paths on the backend
  before applying execution policy. Project registration is not an authorization boundary.
- Enforce containment for application file-access endpoints, including traversal and symlinks. This
  does not contain arbitrary shell execution.
- Treat agent text and tool output as untrusted: disable raw HTML in Markdown, restrict link
  schemes, and never execute generated UI content.
- Keep storage and credentials private to the user.

## Frontend design

Retain Solid 2 and use the framework-independent `@tanstack/ai-client` through a small local Solid 2
binding. The binding bridges client state into Solid reactivity and owns subscription cleanup;
TanStack supplies headless chat state and stream processing. Use locally owned Solid 2 components
for message, part, and tool rendering, not TanStack's framework-specific bindings or UI packages.
Application features own the branch tree, navigation, layout, composer, styling, and coding-specific
tool components. Pi Durable retains backend execution ownership.

The diagnostic client already uses Solid 2; the TanStack client integration is selected but not yet
implemented. Verify the client API and AG-UI mapping against the pinned version during integration.

Follow [DESIGN.md](DESIGN.md) for presentation and [AGENTS.md](AGENTS.md#ui-primitives) for
component conventions. [MVP.md](MVP.md#frontend-integration) defines frontend integration details
and initial tooling limits.

### Frontend references

Selected client dependency:

- [TanStack AI client](https://tanstack.com/ai/latest/docs/api/ai-client)
  ([source](https://github.com/tanstack/ai)): framework-independent headless chat state and
  transport integration through the local Solid 2 binding.

Implementation references, not selected dependencies:

- [Kobalte](https://github.com/kobaltedev/kobalte): Solid patterns and primitive composition.
- [Base UI](https://github.com/mui/base-ui): composition, interactions, and state management.
- [React Aria](https://react-aria.adobe.com/): input interactions.
- [Corvu](https://corvu.dev/): overlays and resizable panels.
- [Zag](https://zagjs.com/): complex control states and transitions.
- [assistant-ui](https://github.com/assistant-ui/assistant-ui): chat composition and message, part,
  and tool rendering.

Kobalte and Base UI are the primary shared-component references. Adapt behavior to Solid 2, local
ownership, and semantic tokens; verify compatibility before reusing source. Visual inspiration and
conversation UX references belong in [DESIGN.md](DESIGN.md#reference-and-ownership).

## Integration verification

[MVP.md](MVP.md#models-and-credentials) defines model and credential integration. Its
[open decisions](MVP.md#open-decisions) and [acceptance checks](MVP.md#acceptance-checks) cover
runtime readiness, isolation, and browser behavior. The architecture describes the agreed target;
acceptance checks establish operational readiness.

## Sources

Verify referenced APIs against the pinned dependency versions.

- [Pi Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md):
  experimental API, persistence, deduplication, snapshots, cancellation, replay, and storage
  ownership.
- [Pi AI README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md): provider
  factories, model catalogs, authentication, and credential stores.
- [Durable SQLite specification](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md#112-sqlite)
  and
  [submission/task outcomes](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md).
- [Hono RPC](https://hono.dev/docs/guides/rpc): inferred inputs/responses and global error typing.
- [AG-UI events](https://docs.ag-ui.com/concepts/events): message and state snapshots, incremental
  updates, tools, and run lifecycle.
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware): tsgolint
  integration.
- [Solid 2](https://v2.solidjs.com/),
  [Tailwind theme variables](https://tailwindcss.com/docs/theme), and [Lucide](https://lucide.dev/).
- Playwright [local servers](https://playwright.dev/docs/test-webserver) and
  [best practices](https://playwright.dev/docs/best-practices).