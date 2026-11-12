# Effect 4 backend migration

Status: slices 1–3 implemented; slices 4–5 remain. This plan was recorded on November 12, 2026 and
subsequently revised after the user dropped terminal runtime/extension parity. Slice 3
implementation is authorized under the direct SDK approach. Watchers remain a separate proposal.

## Purpose and authority

Move Pagoda's backend to Effect 4, including Effect Schema, HttpApi, HTTP/SSE, resource ownership,
and platform I/O. Keep React/TanStack presentation and the thin Electron shell. Replace the Pi JSONL
RPC integration with direct, in-process Pi SDK sessions.

Pagoda is a Pi SDK application with native Pi session compatibility, not a graphical replica of the
terminal setup. Users can see regular Pi histories and continue them with Pagoda's execution
configuration; terminal extensions and launcher behavior need not be reproduced. The reason for
Effect remains coherent ownership of concurrent work and resources, not replacing every function or
class with an Effect service.

This is an execution plan, not a second product specification or a description of implemented
architecture. Read the workspace [AGENTS.md](../AGENTS.md) and its root guidance first.

- [Vision](../docs/vision.md): product direction, scope, and non-goals.
- [Domain](../docs/domain.md): terminology, ownership, and invariants.
- [Workspace specification](../docs/specs/workspace.md): approved target behavior and client
  policies.
- [Architecture](../docs/architecture.md): current implementation and known gaps.
- [Decisions](../docs/decisions.md): technical rationale, including the earlier Pi RPC decision.
- [Development](../docs/development.md): startup, explicit restarts, and isolated verification.

Approved behavior takes precedence over existing implementation details. If new evidence invalidates
the agreed approach or requires a consequential behavior change, pause the affected slice and
resolve that decision rather than silently expanding this plan.

The SDK direction supersedes this plan's original requirement to reuse `../pi/runtime`. The vision,
domain, workspace spec, architecture, and agent guidance now record that target; ADR-013 supersedes
the previous subprocess/RPC rationale. Keep those documents aligned without restoring old parity
requirements or rewriting unrelated product requirements.

## Background and constraints

At planning time, Pagoda uses Hono on Node, TypeBox contracts in `src/desktop-api.ts`, a handwritten
fetch/EventSource client in `src/renderer/http-api.ts`, and Promise-based backend owners.
`src/backend/server.ts` coordinates HTTP/workspace startup and shutdown; `events.ts` manages SSE
subscriptions and timers; `rpc.ts` owns Pi children and pending commands. `workspace.ts` currently
combines execution-owner management, metadata notifications, and native catalog discovery.

Slices 1 and 2 replaced Hono/TypeBox with Effect HTTP, HttpApi, and Effect Schema. Slice 3 replaced
the terminal RPC and desktop bridge integration with direct SDK execution and native discovery.

The revised target does not depend on that runtime. Pagoda owns its SDK configuration, resources,
and future tools/extensions, using public Pi APIs. Do not copy the terminal extension list or
reimplement terminal launcher parity. Existing Pi helpers are evidence for behavior that matters,
not an integration dependency to preserve. In particular, the fork helper protects source history
from mutations during legacy-session migration; preserve that outcome when replacing the bridge.

Trust the SDK's documented contracts. Use installed declarations for the installed version and
normal implementation-time API reference reads. No SDK feasibility spike, separate two-session
prototype, terminal-extension compatibility audit, or proof of Pi's own session features is
required. Tests establish Pagoda's configuration and lifecycle wiring, not whether the SDK deserves
trust.

Important migration constraints, with full requirements owned by the linked specification:

- A request or observation connection does not own Pi execution. Disconnection must not cancel work.
- Execution-owner keys differ from persisted session IDs/files. Preserve reopen deduplication,
  disposal before replacing a writer, and routing commands to their originating owner.
- A lost command confirmation leaves submission uncertain, not automatically safe to retry.
- Preserve schema validation at HTTP, SSE, and persisted application-data boundaries. Replace
  transport decoding with typed SDK calls/events rather than retaining RPC schemas around SDK
  objects. Clients receive Pagoda presentation data, not SDK internals or credentials.
- Retain the spec's authentication, Host/Origin checks, same-origin JSON writes, cookie and browser
  response policies, and authenticated image proxy. Image response-size/time limits remain wanted.
- Custom slow-observer queue limits/write-deadline eviction, HTTP/RPC request-size limits, and
  connection termination for malformed or oversized Pi records are rejected target policies. Remove
  their implementations and obsolete tests in the relevant slices; do not recreate them as Effect
  settings for migration parity. Validation and meaningful error reporting remain.
- Dispose SDK sessions and terminate their active work when the backend stops. The old Pi child
  stdin/SIGTERM/SIGKILL escalation is transport-specific and becomes obsolete when that child is
  removed; do not introduce workers solely to retain it.
- Keep JSON metadata persistence and the accepted occasional simultaneous-write collision. This
  migration does not introduce SQLite, cross-process locking, or cross-backend execution ownership.

The user prefers simple ownership boundaries and avoiding speculative recovery or compatibility
layers. React remains React; Effect execution belongs behind a small client adapter rather than
spreading through components, navigation, and drafts.

In-process SDK sessions share the backend process. Accept that boundary for this design; do not add
worker isolation without a concrete need and an approved change of approach. Configure sessions
explicitly rather than switching process-global cwd/environment between owners.

Viewing and execution are distinct: viewing a saved terminal history does not require its old
extensions; resuming uses Pagoda's available tools and instructions, not a promise to recreate the
old environment. Preserve sequential terminal/Pagoda handoff and avoid a second history format.

Resource and account configuration is settled in the
[workspace specification](../docs/specs/workspace.md#launch-and-configuration) and
[ADR-014](../docs/decisions.md#adr-014-shared-pi-resources-and-per-session-account-selection): share
`ai/skills/`, `ai/prompts/`, the appended `ai/SYSTEM.md`, normal project instruction discovery, and
existing per-profile credential files. As refined by
[ADR-015](../docs/decisions.md#adr-015-global-account-selection-for-new-execution-owners), expose
all accounts through one global selection for new execution owners, not terminal account switching.
Keep tools/extensions Pagoda-owned and login/account creation in terminal Pi initially. Pagoda
rejects terminal code-navigation selection; terminal Pi retains it. No SDK-evaluation prerequisite
is needed.

## Agreed target boundaries

The tree expresses responsibilities, not a requirement to create every file immediately. Keep small
endpoint groups together until a split helps. Do not build parallel service/interface/implementation
trees or duplicate internal models that merely mirror wire schemas.

```text
src/
  contracts/                  # Browser-safe schemas, derived types, HttpApi declarations
    api.ts                    # Endpoint-group assembly
    workspace.ts              # Workspace commands and snapshots
    sessions.ts               # Catalog, metadata, history
    observation.ts            # SSE event schemas
    auth.ts                   # Authentication contract/middleware declaration

  backend/
    entry.ts                  # CLI arguments, signals, runtime launch
    app.ts                    # Composition root: configuration and Layers
    http/
      server.ts               # HTTP server and route composition
      workspace.ts            # Workspace handlers
      sessions.ts             # Catalog/metadata/history handlers
      observation.ts          # SSE encoding and response lifecycle
      auth.ts                 # Credential exchange and authentication
      policies.ts             # Host/Origin checks and response policies
      images.ts               # Image proxy
      assets.ts               # Production assets
    workspace.ts              # Open execution owners and their lifetimes
    session.ts                # One execution owner's state and commands
    observation.ts            # Backend subscriptions and current snapshots
    catalog.ts                # Saved-session discovery and invalidation
    session-metadata.ts       # Pins/favourites persistence
    settings.ts               # Settings schema and loading
    freshness.ts              # Future watcher hints/coalescing; not migration completion
    pi/
      session.ts              # Public SDK session creation, configuration, event projection

  renderer/
    api/
      client.ts               # Generated HttpApi client and Promise-facing adapter
      observation.ts          # SSE connection and decoding
    ...                       # Existing React features and shared UI

  electron/
    entry.ts
    main.ts
```

Contracts import neither Node nor backend/React implementation. HTTP handlers decode, delegate, and
encode; they do not mutate session state, discover native files, or decide execution-owner reuse.
The catalog discovers native histories through public Pi session APIs, independently of a running
execution owner. Backend observation owns subscriptions and snapshots; HTTP observation owns their
encoding and connection lifetime.

```text
Backend scope
  +-- HTTP server
  +-- workspace
  |     +-- execution-owner scopes
  |           +-- Pi SDK sessions and event subscriptions
  +-- future filesystem watchers

HTTP observation scope
  +-- subscription and response stream, not execution
```

`app.ts` composes dependencies. Features do not create independent runtimes or use a global runtime
to locate dependencies. Temporary Promise adapters are acceptable during migration and removed when
their callers migrate. No permanent Hono/Effect or TypeBox/Effect contract duplication is intended.

## Delivery slices

Run slices in order. Each completion condition is verifiable using the existing application plus
earlier slices, without requiring later slices. Update progress and material findings here during
authorized execution; routine file/API choices can follow evidence without reopening the design.

### 1. Effect Schema contracts

Implemented: Effect 4.1.4 replaces Pagoda's TypeBox schemas, including private Pi validation. Hono
and Promise backend ownership remain. Verify current test results and working-tree status when
resuming; no changes have been staged by the implementing agent.

- Check the working tree and preserve existing user changes, including staged/unstaged layers.
  Historical handoff Git-status claims are not the current working-tree state.
- Verify supported Effect 4 and matching Node-platform package versions against configured Node,
  TypeScript, and build behavior. Inspect installed sources first; use official version-specific
  documentation for missing evidence. Do not copy v3 or early-beta imports into the migration.
- Replace `desktop-api.ts` with shared contracts; convert Pagoda's HTTP/client, SSE, persistence,
  and private Pi boundary validation to Effect Schema.
- Keep Hono and Promise backend ownership for this slice. Preserve decoding semantics intentionally,
  including extra provider fields and current distinctions between rejection and uncertainty.
- Update TypeScript/build includes and root lint import-boundary rules that currently name
  `src/desktop-api.ts`; the new contracts directory needs equivalent browser-safety enforcement.
  Restrict collateral root changes to those needed for this migration.

Completion: existing HTTP, RPC, metadata, and session flows use Effect Schema; Pagoda no longer
maintains competing TypeBox contracts. Remove its dependency when no Pagoda imports need it, without
changing other workspaces' TypeBox use.

Verify: typecheck and focused HTTP, RPC, session-metadata, and session integration tests.

### 2. Effect HTTP, HttpApi, and the generated client

Implemented: Effect HTTP and HttpApi now serve workspace commands, static assets, and SSE; the
renderer uses a generated command client. The existing Promise workspace remains the execution
owner. HTTP body limits and custom SSE observer eviction were removed; Pi RPC policies remain for
slice 3. Node listener and request resources are closed through the HTTP scope.

- Define endpoint groups and public errors; replace Hono with Effect HTTP handlers, composition, and
  server lifetime. Adapt existing Promise owners instead of rewriting them in the same step.
- Move React to the generated client behind the Promise adapter. Preserve uncertain-outcome
  reporting and avoid automatic command retries.
- Port retained client policies, authentication, image proxy, and production assets.
- Replace the Hono SSE transport and client decoding while preserving current snapshots on reconnect
  and execution independence. Preserve useful transient-update coalescing without rejected custom
  eviction policies.
- Remove Hono, rejected HTTP/SSE mechanisms, and their obsolete tests. Check the selected platform's
  configurable defaults so rejected request-size policies are not inadvertently reintroduced.

Completion: Effect serves all HTTP/SSE traffic and production assets; browser commands and
observations work through the new client. The existing backend owners remain usable via adapters.

Verify: HTTP, server, and workspace-observation integration tests; focused browser journeys covering
authentication rejection, reconnect, image handling, and uncertain submissions without retries.

### 3. Direct SDK integration and scoped execution ownership

This replaces the originally planned scoped RPC rewrite. The earlier malformed-record handling
question no longer blocks this slice: the private Pi transport is removed, not redesigned.

Implemented: SDK execution, typed presentation, UI bindings, native catalog and scoped ownership
replace the RPC transport and fixtures. The backend-wide account selection is captured by new
owners; existing owners retain their account. The launcher no longer resolves terminal selection.
The approved internal `preflightResult` hook distinguishes acceptance from completion.

The SDK factory fixture exercises application wiring with native persistence; actual SDK tests use
synthetic credentials and a local provider, including active tool cancellation. Workspace checks
pass 56 integration tests; the production build and all 34 browser/Electron journeys pass. These
checks do not establish compatibility with terminal extensions or real providers.

- Keep the owning documents aligned with implementation of the approved SDK direction and resource/
  account configuration. Preserve unrelated behavior.
- Add Pi as a direct Pagoda runtime dependency. Create SDK sessions through public APIs with
  explicit cwd, session storage, resource configuration, and Pagoda-owned tool/extension selection.
  Do not inherit terminal extensions or mutate process-global state for each owner.
- Load the agreed shared resources and existing credential stores. Expose account metadata and a
  global account selection captured by each new execution owner; keep existing owners and their
  active/queued work on their originating accounts. Remove the UI launch path's requirement to
  resolve one terminal account without changing terminal selection behavior. Reuse the
  credential-directory format; a small shared discovery/metadata module is an option, not a
  terminal-runtime dependency.
- Bind SDK session creation, work, event subscriptions, and disposal to backend/execution-owner
  Effect scopes. Requests and observation connections do not own accepted execution.
- Replace RPC commands/events with direct SDK calls and projection into the existing presentation
  model. Preserve prompt acceptance versus completion, follow-up/steering semantics, cancellation,
  notices, and lifecycle transitions. Retain current unsupported-dialog cancellation behavior
  through the SDK UI bindings; a new graphical interaction feature is not part of this slice.
- Discover/read native terminal histories and implement existing navigation/fork operations through
  public SDK/session APIs. Move the discovery path needed for removing the bridge into `catalog.ts`
  here rather than leaving a dependency on a running RPC child until slice 4.
- Preserve reopen reservations, one execution owner per active session, and disposal before
  replacing a writer. Preserve source-history protection during forks and reading saved histories.
- Remove Pagoda's Pi JSONL transport, protocol framing/response-correlation schemas, pending-command
  timers, size limits, and malformed-record termination logic, along with obsolete transport tests.
  HTTP lost-response uncertainty and no automatic command retry remain applicable.
- Remove the dependency on `../pi/runtime/rpc-entry.ts` and desktop bridge. Do not remove terminal
  runtime files or rewrite the terminal setup as incidental cleanup. Adapt the launcher-facing
  arguments only as needed for Pagoda; decide consequential user-visible changes first.
- Replace temporary lifecycle adapters. Migrate fake-RPC fixtures/tests that exercise affected
  application journeys to a suitable SDK seam or deterministic SDK execution so the application and
  test suites remain coherent at the end of this slice.

Completion: Pagoda runs SDK sessions in-process without the terminal runtime or Pi RPC transport.
Native terminal histories remain discoverable and reopenable with Pagoda's configuration.
Request/SSE cancellation does not cancel work; backend shutdown disposes sessions and their active
work; concurrent reopen shares one execution owner.

Verify during implementation: extend existing server, session, workspace-ownership, history/fork,
and configured-Pi coverage for the changed integration. Assert that Pagoda passes the intended cwd,
storage/resources, and configuration, does not load terminal extensions accidentally, and releases
subscriptions/work on shutdown. Verify account listing, global selection for new owners, unchanged
accounts for existing owners and their work, and unchanged terminal selection using isolated
profiles. Exercise actual SDK execution with synthetic credentials and harmless tools for
cancellation/disposal where needed. Keep fake boundaries useful for application logic but do not
mistake them for SDK integration checks. No separate prerequisite evaluation phase is needed.

### 4. Finish backend responsibility boundaries

- Finish any responsibility separation left after slice 3's SDK/catalog integration, without
  introducing a second session engine.
- Separate backend observation from SSE encoding; finish scoped subscription cleanup.
- Use Effect filesystem operations for metadata/settings while preserving JSON format and current
  configuration behavior.
- Remove remaining transitional adapters, obsolete interfaces, and superseded tests.

Completion: handlers translate contracts; workspace/session own execution; catalog owns discovery;
backend subscriptions close independently of work. No new filesystem freshness behavior is required.

Verify: workspace, metadata, and observation tests; focused browser journeys for streaming,
reconnection, history navigation, and forks.

### 5. Integrated verification and reader guidance

- Update architecture and significant accepted technical rationale as implemented. Mark superseded
  decisions rather than rewriting history; do not silently change the product specification.
- Update startup/development instructions only where actual reader actions change, including SDK
  fixtures and credential-free verification.
- Check for obsolete RPC/terminal-parity requirements, Hono/TypeBox references, dependencies, and
  migration scaffolding. Preserve truthful historical context for completed slices.

Completion: agreed migration boundaries are implemented and production/browser/Electron journeys are
verified, or outstanding failures and verification limits are precisely reported.

Run `pnpm run check` and `pnpm run test:e2e` from this workspace. Do not separately repeat checks
these commands include without an intervening relevant change.

## Separate proposed feature: filesystem freshness

Watchers motivated the platform discussion, but final watcher behavior and implementation remain
unapproved. They are not a condition for completing this migration. The
[watcher handoff](../docs/handoff-2026-11-12-fs-watcher.md) contains prior evidence and proposals;
its historical authorization/status notes do not authorize new work.

Recommended first scope, subject to approval: metadata plus session-catalog/sidebar freshness, not
live viewing of an externally running transcript.

Before dependent implementation, establish native store roots, directory/replacement coverage,
refresh cost, observer lifetime, and error handling through focused source inspection and bounded
local experiments using the selected Effect version. No recursive-watch or missed-event recovery
guarantee has been established.

Proposed flow: filesystem hints -> relevant-path filtering -> burst coalescing -> authoritative
metadata reread or catalog invalidation -> backend observation -> client refresh. Keep live SDK
events authoritative for running transcripts and execution state; avoid rescanning every history on
each streaming write. Preserve explicit Refresh and immediate notifications for local metadata
writes. Watching does not prevent simultaneous JSON write collisions or concurrent native-session
editing.

If approved, verify cross-backend metadata updates, external catalog creation/update/deletion,
unchanged-value suppression, coalescing, file replacement, and shutdown cleanup. Extend existing
metadata/observation/workspace/browser coverage where appropriate. Update only the specification
clauses that currently require manual refresh and describe absent live metadata synchronization.

## Verification and resumption

For focused Node tests, use the existing runner shape with selected test paths, for example:

```sh
pnpm exec node --experimental-test-module-mocks --test \
  tests/integration/server.test.ts tests/integration/workspace-ownership.test.ts
pnpm run typecheck
```

Choose additional assertions for concrete regression risks; do not preserve tests of rejected
policies. Use deterministic providers, isolated temporary state, and synthetic credentials. Follow
the development guide's display prerequisites and explicit-restart rules; do not restart a running
backend with active work. Full Electron checks on this Linux host use isolated Xvfb.

At resumption, inspect the current working tree and dependencies. Obtain authorization to implement
the revised slice 3 if absent, apply the agreed resource/account configuration and launcher-option
decision, and use the documented SDK contracts directly. Preserve unrelated changes and report
unrelated failures rather than fixing them.