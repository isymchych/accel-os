# Decisions

## ADR-001: Use system Chromium for E2E

Use host Chromium for E2E: `/usr/bin/chromium`, overridable with `WORKSPACE_CHROMIUM_PATH`. This
shares the host installation; rerun E2E after Chromium or Playwright updates to check compatibility.

## ADR-002: Use Solid 2 with native controls

Use Solid 2/Vite, Hono RPC, and Node. Pin tested prereleases and run workspace checks on upgrades.

Own styled native controls locally. Add routing for multiple screens and richer primitives for
concrete interaction needs.

## ADR-003: Use Pi Durable for interactive coding and workflows

Status: accepted direction.

Use `@earendil-works/pi-durable` for interactive coding and future workflows. It combines
conversations with checkpointed recovery, keeping state, cancellation, and lifecycle under one
owner.

Pin a tested version of the experimental API. Replay policies govern interrupted tools; external
effects still need idempotency guarantees. Assess extensions and MCP when they enter scope.

Add another runtime only when a concrete capability justifies a separate execution lifecycle.

## ADR-004: Use the runtime's SQLite storage

Status: accepted direction.

Use Durable's Node SQLite adapter for conversation/execution state and versioned JSON for small
application configuration. SQLite offers indexed reads and transactional commits; the JSONL
alternative keeps the whole history in memory.

Enforce one process per storage. Verify recovery, growth, and backup/restore against the pinned
version. Choose synchronization deliberately: defaults cover process crashes, but power or host
failure may lose recent commits.

## ADR-005: Separate workspace access from agent execution ownership

Status: accepted direction.

Hosts own durable conversations and execution; clients observe and manage them under explicit
permissions. This lets work continue through disconnects and supports future remote hosts and shared
web/mobile views without moving authoritative state into clients.

Start with workspace services and one local host in a Node process. Extend to remote hosts and
environments as membership, authority, and lifecycle policies are defined.

The single-process placement is superseded by
[ADR-010](#adr-010-use-one-explicit-check-and-reload-workflow); host execution ownership remains
unchanged.

## ADR-006: Use pi-ai with workspace-owned configuration

Status: accepted direction.

Use `@earendil-works/pi-ai` for model access and authentication alongside Pi Durable's conversation
and execution lifecycle. Build feature behavior from their supported capabilities, with workspace
services owning product policy.

The workspace owns provider settings, model choices, account configuration, and server-side
credential persistence. Its configuration schemas reflect workspace needs. Pi AI supplies maintained
provider factories, model catalogs, and authentication behavior.

This keeps workspace setup cohesive while concentrating custom code on product-specific choices and
persistence. Provider-supported discovery supplements the catalogs shipped with the installed
library version. [MVP.md](MVP.md#models-and-credentials) defines integration and credential-safety
requirements.

The [agreed first-release scope](VISION.md#agreed-mvp-decisions) narrows this integration to OpenAI
login with multiple accounts used concurrently across conversations. Additional providers, custom
endpoints, and switching an existing conversation's account remain post-MVP; the broader integration
direction above does not make them first-release requirements.

## ADR-007: Use AG-UI for frontend conversation synchronization

Status: accepted direction.

Use AG-UI over HTTP/SSE as the frontend conversation protocol. Adapt Pi Durable's committed state
into message/state snapshots and incremental events. Initialize and reconnect from current
snapshots; replaying every missed streaming event is not required.

This selects a shared wire contract for compatible frontend clients without replacing Pi Durable's
execution, persistence, admission, cancellation, or recovery ownership. Hono RPC remains the
workspace API for operations such as tree/history reads, fork commands, and configuration. Branch
navigation belongs to the application, not the protocol.

The protocol choice does not select a frontend framework, client library, or component library.
[MVP streaming requirements](MVP.md#streaming) and
[transport acceptance checks](MVP.md#integration-checks) govern implementation correctness.

## ADR-008: Use TanStack AI client with a local Solid 2 binding

Status: accepted direction; client integration not yet implemented.

Retain Solid 2 under [ADR-002](#adr-002-use-solid-2-with-native-controls) and use the
framework-independent `@tanstack/ai-client` through a small local Solid 2 binding. Reuse headless
chat state and stream processing without depending on TanStack's framework-specific bindings or UI
packages. Keep rendering, branch navigation, and visible components application-owned.

Pi Durable remains the runtime; this choice does not adopt TanStack Harness or its provider
adapters. [Frontend architecture](ARCHITECTURE.md#frontend-design) owns the integration boundaries.

## ADR-009: Use runtime inspection and Pino local logs for observability

Status: accepted direction; logging integration not yet implemented.

Use committed runtime inspection and history for product visibility, with Pino structured local logs
for operational diagnostics. Runtime records remain the execution source of truth. Keep visibility
in the existing conversation list and details rather than a separate dashboard.

Pino supplies structured logging and contextual fields without maintaining a custom logger. Optional
development-only `pino-pretty` improves local readability. This approach avoids operating a separate
observability stack or duplicating conversation history for diagnostics.

Defer OpenTelemetry, Langfuse, and other external observability platforms. Reconsider when a
concrete need for cross-host tracing, aggregate analysis, or repeatable workflow evaluation
justifies the additional infrastructure. The [MVP observability scope](MVP.md#conversation-activity)
and [architecture logging rules](ARCHITECTURE.md#failure-presentation-and-inspection) define the
implementation contract.

## ADR-010: Use one explicit Check & Reload workflow

Status: accepted direction; reload and the process split are not yet implemented.

The workspace should support using an agent to improve the workspace itself, with a short,
user-controlled feedback loop. Use one local application and one Check & Reload action instead of
separate development/production workflows, automatic watchers, or per-component reload controls.
Keep the existing compiler and verification tools; the product orchestrates their canonical commands
rather than replacing them.

Keep Durable and authoritative application state in a stable main process, with HTTP/UI delivery in
a replaceable API child. This supersedes the single-process placement in
[ADR-005](#adr-005-separate-workspace-access-from-agent-execution-ownership) without introducing
independently deployed services. API and UI reloads must not interrupt agent execution; changes to
main-process code still require restart and recovery.

Use native Durable registry replacement boundaries rather than custom submission-level version
pinning. A running call retains its implementation, but later phases of the same run may use new
code. This trades submission-wide implementation consistency for a simpler, tighter feedback loop;
configured account and execution-context safety remain intact.

[DOMAIN.md](DOMAIN.md#check-and-reload) owns activation behavior and failure semantics;
[ARCHITECTURE.md](ARCHITECTURE.md#build-and-activation) owns the process and build boundaries.