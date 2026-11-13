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
imports. Pi integration uses public APIs, with the prompt-acceptance exception below.

## Pi compatibility

Each SDK session receives explicit cwd, resources, configuration, and a fixed account credential
context. The launcher supplies cwd; the backend handles account selection independently of terminal
Pi. Clients receive non-secret account metadata, not credentials or raw configuration.

Pagoda loads shared instructions, skills, and prompts, with its own tools and no terminal
extensions. Pi APIs provide native session discovery and snapshots without an active execution
owner. Fork publication is atomic, preserves lineage, and does not overwrite existing files.

Pi owns session persistence and credential refresh. Pagoda owns settings and presentation metadata;
metadata operations within one backend are serialized.

Verify compatibility against installed Pi declarations and documentation. Check the revision of any
reference checkout before using its source, and validate upgrades with integration checks.

## SDK and state

HTTP requests are validated at the server and JSON/SSE responses at the client. Typed SDK calls and
events are projected into Pagoda presentation data.

Application errors retain their causes internally and are normalized at the backend boundary:
rejected requests return HTTP 400, operational failures HTTP 500, both as `{ error }`. Clients
distinguish backend, transport, and invalid-response failures, including uncertain command outcomes.

The renderer separates transport, workspace observation/navigation, and per-session interaction.
Shared state comes from the backend; navigation and drafts remain client-owned. Drafts and
unacknowledged submissions persist in session storage, keyed to the execution owner rather than the
persisted Pi session ID.

Commands target execution owners. Their scopes own SDK sessions and active work independently of
HTTP request or connection lifetimes; disconnecting a caller does not cancel execution.

SSE starts with a full workspace snapshot, then sends changed session fields. Slow observers
coalesce to current state; reconnecting takes a fresh snapshot rather than replaying commands.
Revision ordering prevents stale command responses or observations from overwriting newer state.

Pi's `agent_end` can precede retries or queued work; `agent_settled` marks the end of automatic
continuation. Completed Pi messages replace reconstructed streaming output.

SDK prompt acceptance uses Pi's declared internal `preflightResult` callback, an approved
integration exception tested separately from execution completion. Lost HTTP confirmation remains
uncertain, not safe to retry.

## Security and execution

These controls implement the spec's
[local client boundaries](specs/workspace.md#local-client-boundaries).

The backend binds only to `127.0.0.1`. Host validation permits explicit backend/development origins;
foreign Origin and cross-site requests are rejected. API reads, commands, and streams require
authentication except for credential exchange; writes require same-origin JSON requests. There is no
permissive CORS or arbitrary shell, filesystem, environment, or credential API.

The connection URL carries a backend-lifetime credential in its fragment. The frontend removes it
and exchanges it for an HttpOnly, SameSite=Strict cookie. The credential must not be logged beyond
explicit startup output or persisted in app storage. Backend restart invalidates authentication;
clients reconnect through the new connection URL.

The authenticated image proxy fetches HTTP(S) transcript URLs, including local-network URLs, without
browser cookies or referrers. It limits response size and duration and sandboxes successful
responses, including direct viewing.

Markdown disables raw HTML and executable content. Responses enforce referrer and cross-origin
policies. Production uses same-origin assets, a restrictive CSP, and same-origin API connections.
Development alone permits explicit loopback Vite assets, its hot-update connection, and injected
scripts.

Electron loads only an explicit loopback connection URL, with sandboxing, context isolation, and no
Node integration or preload bridge. It opens validated HTTP(S) links without embedded credentials in
the system browser and denies in-app new windows, renderer navigation, webviews, and permission
requests. These controls protect the client boundary; tool execution remains
[unsandboxed](domain.md#execution-authority).

## Process lifetime

The launcher owns separate backend and Electron processes: Electron mode ends with its window, while
browser mode runs until interrupted. Clients attach through an explicit connection URL; there is no
automatic backend discovery, daemon, or crash replay.

Shutdown closes observers, waits for SDK acquisition, binding, and prompt preflight, then aborts
active work, drains session operations, disposes sessions, and settles credential writes. Pi cannot
abort prompt preflight before a run exists.