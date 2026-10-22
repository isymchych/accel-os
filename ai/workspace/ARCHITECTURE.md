# AI workspace architecture

Draft architecture. The technical direction and MVP scope are agreed. Runtime integration remains
proposed where noted.

## Technical direction

- Loopback-only deployment, with separate client and server source in one private npm package.
- TypeScript 7, Node, Vite, Oxlint with tsgolint, and Oxfmt.
- Solid 2, Tailwind v4, locally owned native controls, and semantic theme tokens.
- Hono and TypeBox, with Hono RPC for HTTP reads and commands and Solid state for live SSE
  snapshots.
- Pi Durable for interactive coding and future workflows, subject to
  [integration checks](MVP.md#integration-checks).
- Durable's built-in SQLite storage for execution; versioned, TypeBox-validated JSON for application
  configuration.
- Playwright for browser tests.

[DOMAIN.md](DOMAIN.md) owns behavioral rules; [VISION.md](VISION.md#agreed-mvp-decisions) owns MVP
scope and execution authority. This document owns system structure and lasting technical
constraints; [MVP.md](MVP.md) owns first-release implementation details, open integration questions,
and acceptance checks.

## Ownership and boundaries

```text
Browser: Solid features
  | Hono RPC: reads and commands
  | SSE: committed snapshots
  v
Node: Hono routes -> feature services -> server/runtime/
                                          | Durable harnesses and storage
                                          | tool execution environments
```

One Node process initially hosts workspace services and the local agent host. Production serves UI
and API from one loopback origin; development uses Vite's proxy for API and stream requests. Both
servers bind exclusively to loopback addresses. Development restarts must close the previous storage
owner before opening another.

Reuse Pi's native execution semantics and services; the workspace owns presentation, user intent,
host discovery, and transport. Local execution works directly with the selected environment.
Scheduling and remote provisioning belong to later scope.

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

Define one TypeBox schema per wire shape near its feature in `contracts/` and derive types from it.
Parse external JSON through `@accel-os/shared/json` where applicable. Preserve inferred Hono input
types through the RPC boundary. Keep provider-owned nested data permissive for extra fields;
application contracts are explicit. Normalize internal domain results to wire shapes where they
differ.

Expected route failures have explicit JSON responses and status codes. Unexpected failures use one
sanitized envelope, with detailed diagnostics confined to local logs. Include middleware and global
errors in RPC typing. HTTP failure, durable acceptance, and eventual run failure are distinct.

Validate SSE JSON before it enters trusted client state; streams require their own validation.

## Runtime, persistence, and lifecycle

### Proposed ownership

- **Runtime integration:** harness startup/shutdown, lookup, storage, watches, registries, and
  execution environments.
- **Feature services:** user-selected context, configuration permissions, submission policy, and
  execution authority. Access Durable tools, hooks, and tasks through `server/runtime/`.
- **Durable storage:** single store for transcripts, run status, task scheduling, execution
  diagnostics, and accounting.
- **Application JSON:** registered projects, presets, and persisted preferences.
- **Harness application documents:** metadata that must commit with conversation state, including
  resolved configuration and optional project association. Keep the project catalog in application
  JSON and reference its IDs from harness documents.
- **Client:** drafts, selected views, expanded output, connection state, and command feedback.
  Execution and submission state come from committed runtime records.

Pin an exact tested Durable version: its API is experimental. Review API and persisted-state
compatibility on upgrades and take a restorable backup before storage-changing upgrades. Keep the
integration narrow and specific to Durable's supported APIs.

### Pi reuse

Durable owns the single execution and conversation lifecycle. Do not nest a coding-agent
`AgentSession` inside it.

- Delegate context management, compaction, and overflow recovery to Durable.
- Use its submission inbox, committed task graph, and inspection as the queue and status model. Use
  runtime usage records when exposing consumption.
- When workflows or codemode enter scope, prefer Durable's owned tasks, child conversations, sleeps,
  cancellation propagation, and native codemode.
- Reuse independent resource loaders for skills, templates, and context files where compatible.
  Verify coding-agent extension compatibility before reuse.

Apply these choices within the [agreed MVP scope](VISION.md#agreed-mvp-decisions). Keep credentials
server-side, out of browser storage and Vite-exposed variables. Pi's credential handling owns
refresh.

### Runtime operations and configuration

Backend feature services enforce [configuration safety](DOMAIN.md#configuration-safety). Coordinate
configuration commits and submission admission through one per-conversation boundary in
`server/runtime/`, so each admitted unit receives a consistent resolved configuration. Persist it in
harness-owned application documents as resolved values.

The [MVP runtime integration](MVP.md#runtime-integration) defines operations and runtime-limited
configuration guards.

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

Configuration files and harness commits persist independently. Keep project, preset, and preference
updates independent of admission. Resolve the directory and any selected project/preset before
admitting work; direct directory selection works independently of project registration. Missing
project references produce errors while preserving the configured directory. Future deletion and
reassignment must preserve this invariant.

JSON assumes small, infrequently changed files with one backend writer. Reconsider it when
measurements show costly whole-file replacements or requirements call for cross-file/runtime
transactions.

## Commands, snapshots, and lifecycle

Hono RPC carries reads and commands; SSE carries application-owned snapshots of committed runtime
state. Normalize runtime documents into the browser protocol. Ordinary reads, command feedback, and
live snapshots have separate client ownership.

The runtime owns admission, follow-up placement, cancellation, and restart recovery. Transport
disconnects dispose observation while execution continues. The
[MVP command flows](MVP.md#commands-and-live-state) define routing, deduplication, and streaming;
its [recovery contract](MVP.md#recovery-and-cancellation) defines shutdown and startup integration.

### Failure presentation and inspection

Normalize runtime submission failure reasons/details, tool errors and partial output, terminal task
outcomes, and blocked-work diagnostics into application-owned, browser-safe contracts in
`server/runtime/`. Link summaries to the relevant submission or tool result and preserve the
[distinct failure meanings](DOMAIN.md#activity-outcomes-and-connection).

Runtime storage owns task history. The [MVP work view](MVP.md#work-view) defines inspection and
presentation requirements.

Local logs cover failures outside committed runtime state: HTTP, JSON persistence, startup, and
stream delivery. Include operation and available conversation/submission/task IDs, with sanitized
errors. Exclude raw provider exceptions, credentials, prompts, and tool payloads from browser
details and default logs.

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

Follow [DESIGN.md](DESIGN.md) for presentation and [AGENTS.md](AGENTS.md#ui-primitives) for
component conventions. [MVP.md](MVP.md#frontend-integration) defines frontend integration details
and initial tooling limits.

## Integration status and verification

[MVP.md](MVP.md#modelruntime-integration-status) records the bounded runtime investigation and its
remaining checks. It also owns [open implementation decisions](MVP.md#open-decisions) and
[acceptance checks](MVP.md#acceptance-checks), including isolation and browser coverage. These
distinguish source findings and required behavior from verified implementation.

## Sources

Documentation checked during drafting; verify APIs against the pinned version before implementation.

- [Pi Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md):
  experimental API, persistence, deduplication, snapshots, cancellation, replay, and storage
  ownership.
- [Durable SQLite specification](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md#112-sqlite)
  and
  [submission/task outcomes](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md).
- [Hono RPC](https://hono.dev/docs/guides/rpc): inferred inputs/responses and global error typing.
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware): tsgolint
  integration.
- [Solid 2](https://v2.solidjs.com/),
  [Tailwind theme variables](https://tailwindcss.com/docs/theme), and [Lucide](https://lucide.dev/).
- Playwright [local servers](https://playwright.dev/docs/test-webserver) and
  [best practices](https://playwright.dev/docs/best-practices).