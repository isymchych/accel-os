# Pagoda architecture

This document explains current structure and implementation choices. The
[workspace specification](specs/workspace.md) owns approved behavior and local client policies; an
implementation detail here is not automatically a requirement to preserve during migration.

## Accepted target and current implementation

[ADR-013](decisions.md#adr-013-direct-pi-sdk-sessions-with-native-history-compatibility) accepts
direct, in-process Pi SDK sessions with Pagoda-owned execution configuration and native Pi history
compatibility. It drops reuse of the terminal runtime and extension parity. Credential/account reuse
and project-resource loading remain unresolved in the
[specification](specs/workspace.md#launch-and-configuration).

The SDK migration is not implemented. The sections below describe the current RPC backend, not
requirements to preserve that integration. Browser/Electron HTTP/SSE transport remains unchanged in
the SDK target.

## Current structure

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

Keep workspace runtime code independent of repository-internal packages and private Pi runtime
imports. The current integration uses a Node entry point owned by `ai/pi/`; terminal and RPC entry
points share launch construction. The SDK target replaces that dependency with public Pi APIs, not a
copy of the terminal launcher, extension list, or tool policy.

## Pi compatibility

Current backend startup fixes the profile, launch directory, and code-navigation choice. Each Pi
child uses the repository's Node runtime with its own directory and environment. The canonical RPC
entry reuses the terminal's system prompt, tools, extensions, sessions, and isolated Git
configuration. Pi owns persistence, schemas, credentials, and model configuration; clients receive
neither Pi credentials nor raw configuration.

`runtime/desktop-extension.ts` bridges session discovery and history controls through public Pi APIs
and RPC notifications. The backend verifies bridge availability before issuing controls and does not
fall back to model input. Fork publication preserves lineage and is atomic without overwriting
another file; the [specification](specs/workspace.md#history-navigation-and-forks) defines
source-history protection.

Verify compatibility against installed Pi declarations and documentation. Check the revision of any
reference checkout before using its source, and validate upgrades with integration checks.

## RPC and state

HTTP requests are validated at the server and JSON/SSE responses at the client. The current Pi RPC
boundary uses permissive Effect schemas for consumed fields, accepting extra Pi/provider fields.
Clients receive presentation data, not credentials or raw configuration. The SDK target removes
private RPC decoding in favor of typed SDK calls/events; HTTP/SSE boundary validation remains.

The local RPC transport handles typed commands/events, extension responses, and child exit.
[The historical transport decision](decisions.md#local-rpc-transport) records why it is local rather
than an upstream `RpcClient`; ADR-013 supersedes that choice.

The backend publishes snapshots including partial output; completed Pi messages replace
reconstructed output. Clients resynchronize from current state rather than replaying commands. Pi's
`agent_end` may precede retries or queued work; `agent_settled` marks the end of automatic
continuation.

Commands and observations target an execution-owner key, distinct from the persisted Pi session ID
and file. Client session storage keys drafts to that owner. The
[workspace specification](specs/workspace.md) defines session routing and reconnection behavior.

Current graphical interactions use Pi's RPC dialog contract; see
[supported interactions](../README.md#configuration-and-compatibility).

Current transports bound confirmation waits and honor backpressure. Pi stderr stays in local
diagnostics. Confirmation timeout leaves submission uncertain, not safe to retry.

### Known implementation gap

The
[Effect migration plan](../plans/effect-4-migration.md#3-direct-sdk-integration-and-scoped-execution-ownership)
tracks SDK adoption and scoped execution ownership. The current Pi transport still implements
rejected record-size limits and malformed-record connection termination. Those disappear with
removal of the transport, rather than being redesigned or carried into the SDK integration; see the
spec's [excluded transport policies](specs/workspace.md#excluded-transport-policies).

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

Current backend shutdown closes observers and child stdin for native Pi disposal, then uses bounded
termination if a child does not exit. Startup and attachment are explicit: no automatic discovery,
daemon, or crash replay. The launcher owns backend lifetime; see
[lifecycle behavior](specs/workspace.md#stop-reconnect-and-application-lifetime) for shutdown
triggers and client reconnection.

In the accepted target, backend/execution-owner scopes own SDK sessions, subscriptions, and active
work; HTTP connection scopes do not own execution. SDK session cleanup replaces Pi child-process
shutdown rather than retaining its signal escalation as a separate mechanism.

## Integration references

References, not dependencies or feature checklists:

- [jmfederico/pi-web](https://github.com/jmfederico/pi-web)
- [agegr/pi-web](https://github.com/agegr/pi-web)
- [minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui)

Inspect relevant source and version compatibility before adaptation; do not inherit their broader
product scope.