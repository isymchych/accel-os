# Pagoda architecture

## Structure

```text
React frontend (Vite), in browser or sandboxed Electron
       ↕ authenticated HTTP commands / SSE snapshots
Hono / Node foreground backend (session state, lifecycle)
       ↕ Pi RPC: JSONL commands, responses, events
Node child: ai/pi/runtime/rpc-entry.ts
       └─ existing Pi launcher configuration and native sessions
```

The backend owns Pi children and shared presentation state. Both clients use the same HTTP API;
Electron is only a window shell, with no preload or application IPC.

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
permissive TypeBox schemas for consumed fields, accepting extra Pi/provider fields. Expose only the
data clients need, never credentials or raw configuration.

The local RPC transport handles typed commands/events, extension responses, and child exit.
[The transport decision](decisions.md#local-rpc-transport) records why it is local rather than an
upstream `RpcClient`.

The backend publishes snapshots including partial output; completed Pi messages replace
reconstructed output. Slow observers are disconnected through bounded buffering and write deadlines
without cancelling execution. Clients resynchronize from current state rather than replaying
commands. Pi's `agent_end` may precede retries or queued work; `agent_settled` marks the end of
automatic continuation.

Commands and observations target an execution-owner key, distinct from the persisted Pi session ID
and file. Client session storage keys drafts to that owner. The
[workspace specification](specs/workspace.md) defines session routing and reconnection behavior.

Graphical interactions use Pi's RPC dialog contract; see
[supported interactions](../README.md#configuration-and-compatibility).

Transports bound request sizes and confirmation waits, fail malformed or oversized RPC connections,
and honor backpressure. Keep Pi stderr in local diagnostics. Confirmation timeout leaves submission
uncertain, not safe to retry.

## Security and execution

The backend binds only to `127.0.0.1`. Validate Host against explicit backend/development origins;
reject foreign Origin and cross-site requests. All API reads, commands, and streams require an
authenticated session, except the credential exchange. Writes require same-origin JSON requests.
There is no permissive CORS or arbitrary shell, filesystem, environment, or credential API.

The connection URL carries a backend-lifetime credential in its fragment. The frontend removes it
and authenticates through an HttpOnly, SameSite=Strict cookie. Do not log the credential beyond
explicit startup output or persist it in app storage. Backend restart invalidates authentication;
reconnect through the new connection URL.

Electron loads only an explicit loopback connection URL. Keep sandboxing, context isolation, and no
Node integration; there is no preload bridge. Deny new windows, renderer navigation, webviews, and
permission requests. Render agent output as untrusted text; later Markdown must not enable raw HTML
or executable content. Production loads same-origin assets with a restrictive CSP and same-origin
API connections. Development alone loads Vite from explicit loopback and permits its hot-update
connection and injected scripts.

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