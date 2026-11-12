# Pagoda architecture

## Structure

```text
React frontend (Vite), in browser or sandboxed Electron
       ↕ authenticated HTTP commands / SSE snapshots
Effect HTTP / Node foreground backend (session state, lifecycle)
       ↕ direct Pi SDK calls and events
Scoped in-process SDK sessions
       └─ shared instructions, isolated profile credentials, native session files
```

The Effect/Node backend hosts Pi SDK sessions and shared presentation state. React runs in a browser
or a sandboxed Electron window; both use the same HTTP/SSE API. Electron has no preload or
application IPC. Shared HttpApi declarations and Effect schemas define the client contract.

## Dependency boundaries

Renderer runtime imports stay browser-safe. Contracts do not import Node or implementation code.
Main does not import renderer implementation. The launcher starts Electron rather than importing its
main module. Root lint rules enforce these boundaries.

Workspace runtime code stays independent of repository-internal packages and private Pi runtime
imports. Pi integration uses public APIs, with the prompt-acceptance exception below. Application
fixtures inject a session factory.

## Pi compatibility

Each SDK session receives explicit cwd, resources, configuration, and a fixed account credential
context. The launcher supplies cwd; the backend handles account selection independently of terminal
Pi. Clients receive non-secret account metadata, not credentials or raw configuration.

Pagoda loads shared instructions, skills, and prompts, with its own tools and no terminal
extensions. Pi APIs provide native session discovery and snapshots without an active execution
owner. Fork publication is atomic, preserves lineage, and does not overwrite existing files.

Pi owns session persistence and credential refresh. Pagoda metadata and settings use Effect's
filesystem service; metadata operations within one backend are serialized.

Verify compatibility against installed Pi declarations and documentation. Check the revision of any
reference checkout before using its source, and validate upgrades with integration checks.

## SDK and state

HTTP requests are validated at the server and JSON/SSE responses at the client. Typed SDK calls and
events are projected into Pagoda presentation data.

The backend publishes snapshots including partial output; completed Pi messages replace
reconstructed output. Clients resynchronize from current state rather than replaying commands. Pi's
`agent_end` may precede retries or queued work; `agent_settled` marks the end of automatic
continuation.

Commands and observations target an execution-owner key, distinct from the persisted Pi session ID
and file. Client session storage keys drafts to that owner. Execution-owner scopes own SDK sessions,
subscriptions, and active work; HTTP connection scopes own observation only. Snapshots and
subsequent observations are ordered to preserve concurrent updates.

SDK prompt acceptance uses Pi's declared internal `preflightResult` callback, an approved
integration exception tested separately from execution completion. Lost HTTP confirmation remains
uncertain, not safe to retry.

## Security and execution

The HTTP layer implements the spec's
[local client boundaries](specs/workspace.md#local-client-boundaries): loopback binding, Host/Origin
checks, cookie authentication, browser response policies, and the authenticated image proxy.

Electron loads only an explicit loopback connection URL, with sandboxing, context isolation, and no
Node integration or preload bridge. It opens validated HTTP(S) links without embedded credentials in
the system browser and denies in-app new windows, renderer navigation, webviews, and permission
requests. These controls protect the client boundary; tool execution remains
[unsandboxed](domain.md#execution-authority).

## Process lifetime

Backend shutdown closes observers, waits for SDK acquisition, aborts active SDK work, disposes
sessions, and settles credential writes. The launcher owns backend lifetime: Electron mode ends with
its window, while browser mode runs until interrupted. Clients attach through an explicit connection
URL; startup has no automatic backend discovery, daemon, or crash replay.