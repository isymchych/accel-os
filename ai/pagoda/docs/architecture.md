# Pagoda architecture

This document explains current structure and implementation choices. The
[workspace specification](specs/workspace.md) owns approved behavior and local client policies; an
implementation detail here is not automatically a requirement to preserve during migration.

## Structure

```text
React frontend (Vite), in browser or sandboxed Electron
       ↕ authenticated HTTP commands / SSE snapshots
Effect HTTP / Node foreground backend (session state, lifecycle)
       ↕ Pi RPC: JSONL commands, responses, events
Node child: ai/pi/runtime/rpc-entry.ts
       └─ existing Pi launcher configuration and native sessions
```

The backend owns Pi children and shared presentation state. Both clients use the same HTTP API;
Electron is only a window shell, with no preload or application IPC. Shared HttpApi declarations and
Effect schemas define the client contract. Pi execution belongs to the backend, independently of
individual requests and observation connections.

## Dependency boundaries

Renderer runtime imports stay browser-safe. Contracts do not import Node or implementation code.
Main does not import renderer implementation. The launcher starts Electron rather than importing its
main module. Root lint rules enforce these boundaries.

Keep workspace runtime code independent of repository-internal packages. The integration boundary to
the existing setup is a Node entry point owned by `ai/pi/`, not imports of its private runtime
modules into the backend. Terminal and RPC entry points share launch construction; do not copy the
extension list or tool policy.

## Pi compatibility

Backend startup fixes the profile, launch directory, and code-navigation choice. Each Pi child uses
the repository's Node runtime with its own directory and environment. The canonical RPC entry reuses
the terminal's system prompt, tools, extensions, sessions, and isolated Git configuration. Pi owns
persistence, schemas, credentials, and model configuration; clients receive neither Pi credentials
nor raw configuration.

`runtime/desktop-extension.ts` bridges session discovery and history controls through public Pi APIs
and RPC notifications. Verify bridge availability before issuing controls; never fall back to model
input. Fork publication preserves lineage and is atomic without overwriting another file; the
[specification](specs/workspace.md#history-navigation-and-forks) defines source-history protection.

Verify compatibility against installed Pi declarations and documentation. Check the revision of any
reference checkout before using its source, and validate upgrades with integration checks.

## RPC and state

Validate HTTP requests at the server and JSON/SSE responses at the client. Validate Pi RPC with
permissive Effect schemas for consumed fields, accepting extra Pi/provider fields. Expose only the
data clients need, never credentials or raw configuration.

The local RPC transport handles typed commands/events, extension responses, and child exit.
[The transport decision](decisions.md#local-rpc-transport) records why it is local rather than an
upstream `RpcClient`.

The backend publishes snapshots including partial output; completed Pi messages replace
reconstructed output. Clients resynchronize from current state rather than replaying commands. Pi's
`agent_end` may precede retries or queued work; `agent_settled` marks the end of automatic
continuation.

Commands and observations target an execution-owner key, distinct from the persisted Pi session ID
and file. Client session storage keys drafts to that owner. The
[workspace specification](specs/workspace.md) defines session routing and reconnection behavior.

Graphical interactions use Pi's RPC dialog contract; see
[supported interactions](../README.md#configuration-and-compatibility).

Transports bound confirmation waits and honor backpressure. Keep Pi stderr in local diagnostics.
Confirmation timeout leaves submission uncertain, not safe to retry.

### Known implementation gap

The
[Effect migration plan](../plans/effect-4-migration.md#3-scoped-execution-ownership-and-pi-transport)
tracks the remaining Pi RPC gap against the spec's
[excluded transport policies](specs/workspace.md#excluded-transport-policies).

## Security and execution

The HTTP layer implements the spec's
[local client boundaries](specs/workspace.md#local-client-boundaries): loopback binding, Host/Origin
checks, cookie authentication, browser response policies, and the authenticated image proxy.

Electron currently loads only an explicit loopback connection URL, with sandboxing, context
isolation, and no Node integration or preload bridge. It opens validated HTTP(S) links without
embedded credentials in the system browser and denies in-app new windows, renderer navigation,
webviews, and permission requests. These are small native settings and handlers; no change to them
has been decided.

These controls protect the UI boundary, not Pi tools; see
[execution authority](domain.md#execution-authority).

## Process lifetime

Backend shutdown closes observers and child stdin for native Pi disposal, then uses bounded
termination if a child does not exit. Startup and attachment are explicit: no automatic discovery,
daemon, or crash replay. The launcher owns backend lifetime; see
[lifecycle behavior](specs/workspace.md#stop-reconnect-and-application-lifetime) for shutdown
triggers and client reconnection.

## Integration references

References, not dependencies or feature checklists:

- [jmfederico/pi-web](https://github.com/jmfederico/pi-web)
- [agegr/pi-web](https://github.com/agegr/pi-web)
- [minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui)

Inspect relevant source and version compatibility before adaptation; do not inherit their broader
product scope.