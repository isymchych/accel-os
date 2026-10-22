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