# Decisions

## ADR-011: Local Electron interface to the existing Pi setup

Status: accepted.

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

[DOMAIN.md](domain.md) owns lifecycle rules; [ARCHITECTURE.md](architecture.md) owns integration and
security boundaries; [MVP.md](mvp.md) owns release requirements.