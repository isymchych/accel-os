# Pagoda architecture

## Structure

```text
React renderer (Vite)
       ↕ narrow contextBridge API / Electron IPC
Electron main (windows, session state, lifecycle)
       ↕ Pi RPC: JSONL commands, responses, events
Node child: ai/pi/runtime/rpc-entry.ts
       └─ existing Pi launcher configuration and native sessions
```

Electron main owns each active Pi child and its live presentation state; React observes it through a
narrow preload API. TypeScript spans both sides. Vite with the official React plugin builds the
renderer; Tailwind and semantic tokens provide presentation infrastructure. Locally owned shadcn/ui
components use Base UI primitives and Lucide icons.

## Source ownership

- `src/renderer/`: React screens, feature state, domain-free controls, and semantic styles.
- `src/desktop-api.ts`: environment-neutral desktop API, request schemas, and presentation types.
- `src/electron/`: main/preload, Pi RPC integration, and session observation.
- `scripts/launch.ts`: development/startup and process cleanup; package scripts own build commands.
- `tests/integration/`: Node checks with fake execution and isolated state.
- `tests/e2e/`: actual Electron renderer/preload/main journeys.
- `../pi/runtime/`: terminal/desktop routing and canonical Pi launch configuration.

Renderer runtime imports stay browser-safe. Contracts do not import Node or implementation code.
Main does not import renderer implementation. The launcher starts Electron rather than importing its
main module. Root lint rules enforce these boundaries.

Keep workspace runtime code independent of repository-internal packages. The integration boundary to
the existing setup is a Node entry point owned by `ai/pi/`, not imports of its private runtime
modules into Electron. Terminal and RPC entry points share launch construction; do not copy the
extension list or tool policy.

## Pi compatibility

`ai ui` resolves the existing profile and passes its directory, launch directory, and
code-navigation choice to the app. Electron starts `rpc-entry.ts` with the repository's Node
executable, not Electron's executable. Each child gets its own working directory and environment.
The RPC entry reuses `ai/SYSTEM.md`, explicit built-ins/extensions, excluded tools, shared session
directory, and isolated agent Git configuration.

Pi owns session persistence, schemas, credentials, and model configuration.

The RPC entry additionally loads `runtime/desktop-extension.ts`, a desktop-only bridge built on
public Pi APIs. Discovery uses `SessionManager.list`; tree navigation uses the extension command
context. Correlated results travel through RPC notifications, not raw stdout (Pi guards extension
stdout). Electron verifies bridge availability before issuing control commands; controls never fall
back to model input.

Forks open a private copy with `SessionManager`, so legacy migrations cannot rewrite the live
source. Pi constructs the selected branch; the bridge restores source lineage and publishes the
destination atomically without overwriting another file. The bridge's `snapshot` operation creates
the fork's session file.

Verify compatibility against installed Pi declarations and documentation. Check the revision of any
reference checkout before using its source, and validate upgrades with integration checks.

## RPC and state

Validate external JSON at the RPC boundary with permissive TypeBox schemas for the fields consumed.
Accept extra Pi/provider fields. Translate only necessary data into explicit renderer types; do not
send credentials or raw configuration.

The local RPC transport handles typed commands/events, extension responses, and child exit.
[The transport decision](decisions.md#local-rpc-transport) records why it is local rather than an
upstream `RpcClient`.

Main owns the live presentation snapshot, including current partial text. It survives renderer
reloads. Completed Pi messages replace reconstructed partial output. Revision numbers prevent a late
initial snapshot from overwriting a newer observation. Transient text/tool deltas coalesce before
cloning and forwarding a full snapshot; completed messages and lifecycle changes publish
immediately. The main-owned workspace reuses active owners and reserves pending opens. Commands
carry an explicit session key; renderer selection never retargets a child or an outstanding request.
Drafts use the same key and are retained in renderer session storage.

Each open session has an execution owner. The owner's `key` routes commands and observations;
`sessionId` identifies the Pi session, and `sessionFile` locates its persisted history. Reopening
saved history after its child exits creates a new owner and key for the same Pi session.
`SessionSnapshot` carries a copy of live presentation state to the renderer.

Graphical interactions use Pi's RPC dialog request/response contract.
[README.md](../README.md#configuration-and-compatibility) describes supported interactions.

### Wire contract and limits

- Split JSONL only at LF, preserving Unicode separators and chunked UTF-8. Correlate responses by
  request ID and command; consume stdout continuously and honor stdin backpressure. Stderr stays
  local diagnostics.
- Records are limited to 16 Mi characters; oversized or malformed records fail the connection.
  Prompt IPC accepts up to 100,000 characters.
- Command confirmation has a 30-second deadline. Timeout leaves submission uncertain, not eligible
  for automatic resubmission.

## Security and execution

Use sandboxed renderers, context isolation, no Node integration, and specific preload methods.
Validate IPC payloads and restrict callers to the application's main frame and exact loaded URL. Do
not expose arbitrary IPC, shell, filesystem, environment, or credential APIs.

Deny new windows, renderer navigation, webviews, and permission requests. Render agent output as
untrusted text; later Markdown must not enable raw HTML or executable content. Production loads
local assets with a restrictive CSP and no network connections. Development alone loads Vite from
explicit loopback and permits its hot-update connection and injected scripts.

These controls protect the UI boundary, not Pi tools; see
[execution authority](domain.md#execution-authority).

## Process lifetime

Main owns children independently of renderer observation. App quit closes child stdin for native Pi
disposal, then uses bounded termination if the child does not exit.

## Integration references

References, not dependencies or feature checklists:

- [jmfederico/pi-web](https://github.com/jmfederico/pi-web)
- [agegr/pi-web](https://github.com/agegr/pi-web)
- [minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui)

Inspect relevant source and version compatibility before adaptation; do not inherit their broader
product scope.