# Decisions

## ADR-011: Local Electron interface to the existing Pi setup

Status: UI transport and app-lifetime execution superseded by ADR-012 below. The configured Pi
subprocess, native-session, and local Pi RPC transport decisions remain applicable.

### Why Electron and plain Vite

Electron supplies desktop lifecycle and Chromium DevTools; React and plain Vite with the official
React plugin supply presentation and renderer hot updates. TypeScript spans both sides.

Standard build tools and a small development script keep the integration locally understandable.
Renderer edits update live; main/preload/integration edits require an explicit restart to protect
active agent work from source-watch restarts.

### Why configured Pi subprocesses rather than the SDK

Reusing the canonical `ai/pi/` launch configuration keeps terminal and desktop behavior aligned
without maintaining another profile, tool, or extension setup. A Node RPC child also gives each
session its own working directory and environment rather than retargeting process-global state.

The direct SDK is an alternative for in-process integration. RPC fits this setup because it
preserves the existing CLI launch semantics and process-local configuration.

### Why native sessions and app-lifetime execution

Native Pi persistence permits sequential terminal/desktop handoff without introducing a second
history format. The single-writer constraint rules out concurrent editing of the same session.
Graphical controls adapt Pi interactions rather than sharing terminal widgets.

Main-process ownership lets renderer refresh and session navigation preserve active work without
requiring a separate daemon. The tradeoff is that app quit ends active execution and there is no
background service or automatic crash recovery; persisted history does not resume unfinished work.

### Local RPC transport

The desktop needs extension-response writing and child-exit observation as well as typed commands
and events. Upstream `RpcClient` does not expose all those hooks, so the desktop uses a local
transport. Reconsider upstream reuse when its public API covers this boundary.

## ADR-012: One local HTTP application with browser and Electron clients

Status: accepted. Supersedes ADR-011's renderer IPC and app-lifetime execution choices. The Hono
implementation described below has since been replaced by Effect HTTP; the transport decision
remains.

Hono on Node owns a foreground backend. HTTP commands and SSE observations are the sole application
transport; the configured Pi JSONL RPC integration remains unchanged. React runs in a browser or a
thin sandboxed Electron shell. This makes the real application directly available to browser
development tools and moves most integrated journeys to browser tests without maintaining a second
transport or a fixture-only frontend.

The credible alternative was to retain Electron IPC and add a browser development adapter. That
would keep desktop-first lifecycle semantics but duplicate the boundary and would not provide
production browser use.

The consequence is a launcher-owned backend lifetime: browser mode runs until interrupted, while
Electron mode ends with its window. There is no managed service or crash recovery. Execution
configuration belongs to backend startup, and clients use directory-path entry instead of native
dialogs. Local HTTP also introduces an
[authentication and origin-security boundary](architecture.md#security-and-execution); remote access
remains outside scope.