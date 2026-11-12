# Pagoda architecture

This document explains current structure and implementation choices. The
[workspace specification](specs/workspace.md) owns approved behavior and local client policies; an
implementation detail here is not automatically a requirement to preserve during migration.

## Accepted target and current implementation

[ADR-013](decisions.md#adr-013-direct-pi-sdk-sessions-with-native-history-compatibility) accepts
direct, in-process Pi SDK sessions with Pagoda-owned execution configuration and native Pi history
compatibility. It drops reuse of the terminal runtime and extension parity.
[ADR-014](decisions.md#adr-014-shared-pi-resources-and-per-session-account-selection) accepts shared
skills, prompts, system instructions, and credential files; ADR-015 changes account selection to a
backend-wide choice for new owners, independent of the terminal switcher. The
[specification](specs/workspace.md#launch-and-configuration) owns that behavior.

Normal startup and application fixtures use SDK sessions. Browser/Electron clients use the same
HTTP/SSE transport; backend observation is independent of SSE encoding and connection lifetime.

## Current structure

```text
React frontend (Vite), in browser or sandboxed Electron
       ↕ authenticated HTTP commands / SSE snapshots
Effect HTTP / Node foreground backend (session state, lifecycle)
       ↕ direct Pi SDK calls and events
Scoped in-process SDK sessions
       └─ shared instructions, isolated profile credentials, native session files
```

The backend owns SDK sessions and shared presentation state. Both clients use the same HTTP API;
Electron is only a window shell, with no preload or application IPC. Shared HttpApi declarations and
Effect schemas define the client contract. Pi execution belongs to the backend, independently of
individual requests and observation connections.

## Dependency boundaries

Renderer runtime imports stay browser-safe. Contracts do not import Node or implementation code.
Main does not import renderer implementation. The launcher starts Electron rather than importing its
main module. Root lint rules enforce these boundaries.

Keep workspace runtime code independent of repository-internal packages and private Pi runtime
imports. Normal startup uses public Pi APIs, not the terminal launcher, extension list, or tool
policy. Application fixtures inject a session factory rather than the terminal runtime.

## Pi compatibility

Backend startup discovers existing profiles and selects the first. The authenticated account API and
SSE observations expose non-secret metadata and the backend-wide selection. New SDK owners capture
it; existing owners retain their credential context. The launcher passes only cwd, without resolving
or changing terminal selection. SDK resources use explicit cwd, shared skills/prompts/ system
instructions, and native session storage; terminal extensions are not loaded. Pi owns persistence,
credentials, and model configuration; clients receive neither credentials nor raw configuration.

`catalog.ts` uses public Pi session APIs for native discovery and snapshots independently of a
connected execution owner. Fork publication preserves lineage and is atomic without overwriting
another file; the [specification](specs/workspace.md#history-navigation-and-forks) defines
source-history protection.

The workspace owns execution owners and publishes backend observations; `events.ts` encodes those
observations for each SSE connection. Initial snapshots and subsequent observations are ordered so
an asynchronous metadata read cannot hide a concurrent update. Metadata and settings use Effect's
filesystem service. Metadata operations within one backend are serialized; separate backends still
have the collision and live-update limitations in the specification.

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
and file. Client session storage keys drafts to that owner. The
[workspace specification](specs/workspace.md) defines session routing and reconnection behavior.

SDK UI bindings display notifications and explicitly cancel unsupported dialogs.

SDK prompt acceptance uses Pi's declared internal `preflightResult` callback, an approved
integration exception tested separately from execution completion. Lost HTTP confirmation remains
uncertain, not safe to retry.

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

Backend shutdown closes observers, waits for SDK acquisition, aborts active SDK work, disposes
sessions, and settles credential writes. Startup and attachment are explicit: no automatic
discovery, daemon, or crash replay. The launcher owns backend lifetime; see
[lifecycle behavior](specs/workspace.md#stop-reconnect-and-application-lifetime) for shutdown
triggers and client reconnection.

Execution-owner scopes own SDK sessions, subscriptions, and active work; HTTP connection scopes do
not own execution. SDK session cleanup replaces Pi child-process shutdown rather than retaining its
signal escalation as a separate mechanism.

## Integration references

References, not dependencies or feature checklists:

- [jmfederico/pi-web](https://github.com/jmfederico/pi-web)
- [agegr/pi-web](https://github.com/agegr/pi-web)
- [minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui)

Inspect relevant source and version compatibility before adaptation; do not inherit their broader
product scope.