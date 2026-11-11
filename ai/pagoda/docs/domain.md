# Pagoda domain

## Concepts and ownership

- **Session:** a Pi session with its history tree, active branch, and persisted configuration.
- **History entry:** a node in a session's persisted history tree.
- **Branch:** a path through that tree; navigation changes the active branch within the same
  session.
- **Fork:** a new, independent session copied from persisted history through a selected entry.
- **Working directory:** the local starting context for project resources and tools.
- **Account profile:** an existing `ai/pi/` profile with isolated credentials and shared resources.

The workspace is the app's collection of open sessions.

Pi owns tools, model access, context management, retries, compaction, queues, history, and session
files. The backend owns Pi process lifecycle and shared session state; each client owns navigation,
drafts, and graphical presentation. `ai/pi/` remains the source of truth for agent configuration and
credentials.

## Invariants

- Each active session has one execution owner, shared by clients. Separate owners must never write
  the same session concurrently.
- Prompt acceptance is not completion. Work may start, queue, or be handled by an extension; a tool
  error does not necessarily end execution.
- Connection and execution are independent. Disconnection makes execution unknown, not cancelled,
  failed, or complete.
- Branch navigation preserves history within a session; a fork preserves native Pi format in an
  independent session.

The [workspace specification](specs/workspace.md) owns command, draft, history, and lifecycle
behavior.

## Configuration and interaction compatibility

Share Pi configuration and session formats, not terminal widgets. Configuration changes take effect
at Pi's native boundaries or the next child launch; later profile selection cannot retarget existing
work. Custom terminal UI and TUI-only tools require graphical adaptation.

## Execution authority

Tools run unsandboxed on the host under the user's permissions, without approval gates. The working
directory is not a filesystem boundary. [Architecture](architecture.md#security-and-execution)
defines how the backend and shell protect clients and credentials without restricting tool
authority.