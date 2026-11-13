# Decisions

Current accepted choices and their rationale. [Architecture](architecture.md) describes the system;
the [workspace specification](specs/workspace.md) owns behavior. Original ADRs and superseded
alternatives are preserved in [decision history](decision-history.md).

## One application, browser and Electron clients

HTTP commands and SSE observations are the sole application transport. A shared application makes
browser use and browser-based integration testing first-class, rather than adding a development-only
adapter alongside Electron IPC. Electron is a thin desktop shell.

Electron supplies desktop lifecycle and Chromium DevTools; React and plain Vite provide presentation
and renderer hot updates with standard build tools. Backend and shell changes require explicit
restarts to protect active work; see [development](development.md#development).

The launcher owns the backend: browser mode runs until interrupted, while Electron mode ends with
its window. This avoids a managed service, but active execution ends with the backend; saved history
does not resume unfinished work. Clients use directory-path entry rather than native dialogs. Local
HTTP requires an
[authentication and origin-security boundary](architecture.md#security-and-execution); remote access
remains outside scope.

Sources: [ADR-011](decision-history.md#adr-011-local-electron-interface-to-the-existing-pi-setup),
[ADR-012](decision-history.md#adr-012-one-local-http-application-with-browser-and-electron-clients).

## Direct Pi SDK, native history

The backend hosts in-process Pi SDK sessions with explicit cwd and configuration. Native history
remains portable without reproducing terminal Pi's tools or extensions. Without terminal-runtime
parity, RPC adds protocol and lifecycle machinery without serving its original purpose.

Separate SDK workers would retain process isolation but require another interprocess protocol.
In-process sessions instead share the backend's failure boundary; they must not retarget
process-global cwd or environment for individual sessions.

Use documented SDK contracts and verify integration without a separate feasibility or
terminal-extension compatibility evaluation. The approved exception is the internal
`preflightResult` prompt hook: it confirms started/queued/handled acceptance before execution
finishes. Keep focused regression coverage and revisit the exception when a supported public
equivalent becomes available; execution events alone are not authoritative acceptance.

Fork creation must not invoke runtime fork hooks or let legacy migrations rewrite the live source.

Custom slow-observer queue limits and write-deadline eviction, HTTP/RPC request-size limits, and
connection termination for malformed or oversized Pi RPC records are rejected requirements. Do not
preserve or recreate them for migration parity. Image-proxy response limits, boundary schema
validation, and uncertain-submission handling remain required.

Source:
[ADR-013](decision-history.md#adr-013-direct-pi-sdk-sessions-with-native-history-compatibility).

## Shared resources and credential storage

Pagoda shares instructions, skills, and prompts with terminal Pi, including normal per-directory
project instruction discovery, while owning its tools and extensions. Reuse existing isolated
account credential files through SDK storage rather than copying credentials into a Pagoda store and
duplicating refresh state. The SDK owns credential reads and refresh writes.

Pagoda's launch and account selection are independent of the terminal account switcher. Login and
account creation remain in terminal Pi; the [specification](specs/workspace.md#accounts) defines
credential exposure and selection boundaries.

Source:
[ADR-014](decision-history.md#adr-014-shared-pi-resources-and-per-session-account-selection).

## Account selection fixed per execution owner

One backend-wide account selection, initially the first discovered account, supplies each new
execution owner. Later selections affect new owners only; existing owners keep their account,
including active and queued work. Reopening an active session reuses its owner.

This is simpler than per-session switching while preserving stable credential contexts. Sessions
created at different times can use different accounts without changing terminal Pi's selection. The
[specification](specs/workspace.md#accounts) owns the behavioral contract.

Source: [ADR-015](decision-history.md#adr-015-global-account-selection-for-new-execution-owners).