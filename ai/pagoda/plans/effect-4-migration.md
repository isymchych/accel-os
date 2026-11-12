# Effect 4 backend migration

Status: slice 1 implemented; later slices not started. This plan was recorded on November 12, 2026.
The user authorized slice 1 only; obtain scoped authorization before later slices or watchers.

## Purpose and authority

Move Pagoda's backend to Effect 4, including Effect Schema, HttpApi, HTTP/SSE, resource ownership,
and platform I/O. Keep React/TanStack presentation, the thin Electron shell, and the canonical Pi
JSONL RPC integration. The reason is coherent ownership of concurrent work and resources, not
replacing every function or class with an Effect service.

This is an execution plan, not a second product specification or a description of implemented
architecture. Read the workspace [AGENTS.md](../AGENTS.md) and its root guidance first.

- [Vision](../docs/vision.md): product direction, scope, and non-goals.
- [Domain](../docs/domain.md): terminology, ownership, and invariants.
- [Workspace specification](../docs/specs/workspace.md): approved target behavior and client
  policies.
- [Architecture](../docs/architecture.md): current implementation and known gaps.
- [Decisions](../docs/decisions.md): accepted technical rationale, including the Pi RPC boundary.
- [Development](../docs/development.md): startup, explicit restarts, and isolated verification.

Approved behavior takes precedence over existing implementation details. If new evidence invalidates
the agreed approach or requires a consequential behavior change, pause the affected slice and
resolve that decision rather than silently expanding this plan.

## Background and constraints

At planning time, Pagoda uses Hono on Node, TypeBox contracts in `src/desktop-api.ts`, a handwritten
fetch/EventSource client in `src/renderer/http-api.ts`, and Promise-based backend owners.
`src/backend/server.ts` coordinates HTTP/workspace startup and shutdown; `events.ts` manages SSE
subscriptions and timers; `rpc.ts` owns Pi children and pending commands. `workspace.ts` currently
combines execution-owner management, metadata notifications, and native catalog discovery.

The backend launches `ai/pi/runtime/rpc-entry.ts`. Native discovery/history operations are exposed
through `../pi/runtime/desktop-extension.ts` and `../pi/runtime/desktop-sessions.ts`. Preserve this
public process boundary; do not import private Pi runtime modules into Pagoda or duplicate launcher
configuration. Use installed declarations and the repository's Pi inspection guidance when checking
compatibility.

Important migration constraints, with full requirements owned by the linked specification:

- A request or observation connection does not own Pi execution. Disconnection must not cancel work.
- Execution-owner keys differ from persisted session IDs/files. Preserve reopen deduplication,
  disposal before replacing a writer, and routing commands to their originating owner.
- A lost command confirmation leaves submission uncertain, not automatically safe to retry.
- Preserve schema validation at HTTP, SSE, persistence, and consumed Pi-record boundaries.
  Pi/provider-owned objects accept extra fields; clients receive Pagoda presentation data, not raw
  Pi records or credentials.
- Retain the spec's authentication, Host/Origin checks, same-origin JSON writes, cookie and browser
  response policies, and authenticated image proxy. Image response-size/time limits remain wanted.
- Custom slow-observer queue limits/write-deadline eviction, HTTP/RPC request-size limits, and
  connection termination for malformed or oversized Pi records are rejected target policies. Remove
  their implementations and obsolete tests in the relevant slices; do not recreate them as Effect
  settings for migration parity. Validation and meaningful error reporting remain.
- Bounded forced Pi shutdown was discussed but not rejected or redesigned. Preserve the current
  behavior while migrating resource ownership unless a separate decision changes it.
- Keep JSON metadata persistence and the accepted occasional simultaneous-write collision. This
  migration does not introduce SQLite, cross-process locking, or cross-backend execution ownership.

The user prefers simple ownership boundaries and avoiding speculative recovery or compatibility
layers. React remains React; Effect execution belongs behind a small client adapter rather than
spreading through components, navigation, and drafts.

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
      client.ts               # Child process, JSONL transport, pending commands
      protocol.ts             # Private schemas for consumed Pi protocol

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
The catalog continues to discover through the Pi bridge. Backend observation owns subscriptions and
snapshots; HTTP observation owns their encoding and connection lifetime.

```text
Backend scope
  +-- HTTP server
  +-- workspace
  |     +-- execution-owner scopes
  |           +-- Pi children
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

### 3. Scoped execution ownership and Pi transport

- Move Pi child acquisition, pending command waits, subscriptions, and cleanup into their owning
  scopes. Backend/owner scope, not request scope, owns accepted execution.
- Preserve native launch configuration, reopen deduplication, response correlation, confirmation
  uncertainty, and disposal before replacing a writer.
- Remove rejected RPC size limits and malformed-record connection termination. Check existing
  invalid-record tests and define expected reporting from approved validation behavior; if a
  consequential handling choice remains unresolved, ask rather than inventing recovery.
- Replace temporary lifecycle adapters and retain existing shutdown escalation behavior.

Completion: request/SSE cancellation does not cancel Pi execution, backend shutdown disposes
children, and concurrent reopen shares one execution owner.

Verify: RPC, server, workspace-ownership, and configured-Pi tests. Check actual configured
tool-process termination as well as fake-child cleanup; fake RPC success alone does not establish Pi
compatibility.

### 4. Finish backend responsibility boundaries

- Extract catalog discovery from workspace execution ownership without changing native discovery
  semantics or introducing a second session engine.
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
- Update startup/development instructions only where actual reader actions change. Update the
  AGENTS.md Hono description when it becomes inaccurate.
- Check for obsolete Hono/TypeBox references, dependencies, and migration scaffolding.

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
metadata reread or catalog invalidation -> backend observation -> client refresh. Keep RPC
authoritative for running transcripts and execution state; avoid rescanning every history on each
streaming write. Preserve explicit Refresh and immediate notifications for local metadata writes.
Watching does not prevent simultaneous JSON write collisions or concurrent native-session editing.

If approved, verify cross-backend metadata updates, external catalog creation/update/deletion,
unchanged-value suppression, coalescing, file replacement, and shutdown cleanup. Extend existing
metadata/observation/workspace/browser coverage where appropriate. Update only the specification
clauses that currently require manual refresh and describe absent live metadata synchronization.

## Verification and resumption

For focused Node tests, use the existing runner shape with selected test paths, for example:

```sh
pnpm exec node --experimental-test-module-mocks --test \
  tests/integration/http.test.ts tests/integration/rpc.test.ts
pnpm run typecheck
```

Choose additional assertions for concrete regression risks; do not preserve tests of rejected
policies. Use deterministic providers, isolated temporary state, and synthetic credentials. Follow
the development guide's display prerequisites and explicit-restart rules; do not restart a running
backend with active work. Full Electron checks on this Linux host use isolated Xvfb.

At resumption, inspect the current working tree and dependencies and obtain authorization before
slice 2. Preserve unrelated changes and report unrelated failures rather than fixing them.