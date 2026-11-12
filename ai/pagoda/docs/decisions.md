# Decisions

## ADR-011: Local Electron interface to the existing Pi setup

Status: UI transport and app-lifetime execution superseded by ADR-012 below. Configured Pi
subprocesses and the local RPC transport are superseded by ADR-013; native-session compatibility
remains applicable. The rationale below records the earlier choices.

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
remains. ADR-013 supersedes the Pi RPC integration retained by this decision.

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

## ADR-013: Direct Pi SDK sessions with native history compatibility

Status: implemented. Supersedes ADR-011's configured-subprocess/local-RPC choices and the Pi RPC
integration retained in ADR-012. HTTP/SSE client transport and launcher-owned backend lifetime
remain unchanged.

Pagoda will host Pi SDK sessions directly in its backend, with Pagoda-owned execution configuration,
tools, and extensions. Native terminal session history remains discoverable and reopenable; sharing
history does not require reproducing the terminal runtime or extension environment. The
[workspace specification](specs/workspace.md#launch-and-configuration) owns that compatibility
contract. ADR-014 below settles shared resources and account selection.

The original reason for RPC was reuse of the terminal launcher and isolation of its process-global
configuration. Terminal parity is no longer required, so retaining a subprocess protocol would add
transport and lifecycle machinery without serving that goal. Direct SDK calls replace protocol
framing, response correlation, and the desktop command bridge.

Retaining RPC was the alternative. Hosting the SDK in separate workers would preserve process
isolation but require another interprocess protocol. Neither is the selected design. In-process
sessions share the backend process and its failure boundary; their cwd and configuration are
explicit rather than implemented by switching process-global state.

Use the documented SDK contracts and verify Pagoda's integration during implementation, without a
separate SDK feasibility or terminal-extension compatibility evaluation. The
[migration plan](../plans/effect-4-migration.md#3-direct-sdk-integration-and-scoped-execution-ownership)
tracks delivery.

Exception: the installed SDK declares the `prompt` option `preflightResult` as an internal hook. Its
RPC mode uses that hook for authoritative started/queued/handled confirmation before execution
finishes. Pagoda may use it for the same contract, with focused regression coverage, rather than
guessing acceptance from execution events. Revisit this exception if a supported public equivalent
becomes available.

## ADR-014: Shared Pi resources and per-session account selection

Status: shared-resource and credential-storage choices implemented. Per-session account selection is
superseded by ADR-015. Refines ADR-013 without restoring terminal-runtime or extension parity.

Pagoda shares `ai/skills/`, `ai/prompts/`, and the appended `ai/SYSTEM.md` with terminal Pi, while
retaining normal per-working-directory project instruction discovery. Tools and extensions remain
Pagoda-owned.

Reuse the existing isolated account credential files and their storage format, but not the terminal
account switcher. All existing accounts are available in Pagoda, and account selection belongs to
each session. This permits concurrent work with different accounts without changing terminal Pi's
active profile. The [specification](specs/workspace.md#accounts) owns switching boundaries and
credential exposure rules. Login and account creation stay in terminal Pi initially.

Copying credentials into a separate Pagoda store would duplicate refresh state; using the terminal's
single active-account selection would prevent independent session choices. Neither is selected. The
SDK storage remains responsible for credential reads and refresh writes to the original files.

A small shared module for account discovery and safe metadata is a suitable implementation option;
terminal selection stays separate. Do not turn reuse of account storage into reuse of the terminal
execution launcher. The UI launch path must no longer require resolving one terminal account before
starting Pagoda. The exact SDK wiring for idle-session account changes remains an implementation
choice, subject to the existing single-writer and disposal-before-replacement constraints.

This records configuration decisions, not authorization to implement them or redesign terminal
account storage.

## ADR-015: Global account selection for new execution owners

Status: implemented. Supersedes ADR-014's per-session account-selection and idle switching design;
its shared resource and credential-storage choices remain.

Pagoda presents one backend-wide selection and initially chooses the first discovered account. Each
new execution owner captures that selection. A later selection applies to new owners, not existing
sessions or their active and queued work. Consequently sessions started at different times can use
different accounts without changing the terminal's selection. The
[workspace specification](specs/workspace.md#accounts) owns the behavioral contract.

This is a simpler initial UI than per-session switching, while keeping credential contexts stable
for the lifetime of each owner. Reopening an already active session retains its owner and account.