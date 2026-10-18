# Decisions

## ADR-001: Use system Chromium for E2E

Use the installed Chromium executable for E2E, defaulting to `/usr/bin/chromium` and allowing
`WORKSPACE_CHROMIUM_PATH` to override it. Share the host's browser installation and rerun E2E after
Chromium or Playwright updates to verify compatibility.

## ADR-002: Use Solid 2 with native controls

Use Solid 2 and its Vite plugin for the browser client, with Hono RPC and a Node server. Pin tested
prerelease versions and run the workspace checks on upgrades.

Use locally owned styled native controls. Add routing for navigation across multiple screens and
richer primitives for concrete interaction requirements.

## ADR-003: Use Pi Durable for interactive coding and workflows

Status: accepted direction.

Use `@earendil-works/pi-durable` for interactive coding and future agentic workflows.

Durable combines interactive conversation capabilities with checkpointed execution recovery. One
runtime keeps conversation state, cancellation, and lifecycle ownership together.

Pin a tested version of the experimental API. Interrupted tools follow their replay policy; external
effects require their own idempotency guarantees. Assess extension compatibility and MCP integration
when they enter scope.

Add another runtime only when a concrete capability justifies a separate execution lifecycle.

## ADR-004: Use the runtime's SQLite storage

Status: accepted direction.

Use Pi Durable's built-in Node SQLite adapter for conversation and execution state. Keep small
application configuration in versioned JSON.

SQLite supports indexed reads and transactional commits for long-running conversations. The JSONL
alternative retains the whole history in memory.

Enforce one process per storage. Verify crash recovery, storage growth, and backup/restore against
the pinned version. Choose synchronization settings deliberately: the defaults support ordinary
process-crash recovery, while power or host failure may lose recent commits.

## ADR-005: Separate workspace access from agent execution ownership

Status: accepted direction.

Agent hosts own durable conversations and execution. The workspace provides observation,
coordination, and management through independently connected clients.

Host-owned execution lets admitted work continue across client disconnects and supports future
remote hosts and shared web/mobile views. Each host retains authoritative state; clients observe it
and issue commands under explicit permissions.

Start with workspace services and one local agent host in a single Node process. Extend to remote
hosts and execution environments as their membership, authority, and lifecycle policies are defined.