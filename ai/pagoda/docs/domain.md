# Pagoda domain

## Concepts and ownership

- **Session:** a Pi session with its history tree, active branch, and persisted configuration.
- **History entry:** a node in a session's persisted history tree.
- **Branch:** a path through that tree; navigation changes the active branch within the same
  session.
- **Fork:** a new, independent session copied from persisted history through a selected entry.
- **Working directory:** the local starting context for project resources and tools.
- **Account profile:** an existing `ai/pi/` profile with isolated credentials.
- **Execution owner:** the backend's live SDK session and its fixed credential context. An owner is
  distinct from the persisted session it operates on.

The workspace is the app's collection of open sessions.

Pi owns agent execution machinery, model access, context management, retries, compaction, queues,
native history, and session files. Pagoda owns its execution configuration, tool/extension
selection, SDK session lifecycle, and shared presentation state. Each client owns navigation,
drafts, and graphical presentation.

## Invariants

- Each active session has one execution owner, shared by clients. Separate owners must never write
  the same session concurrently.
- Prompt acceptance is not completion. Work may start, queue, or be handled by an extension; a tool
  error does not necessarily end execution.
- Connection and execution are independent. Disconnection makes execution unknown, not cancelled,
  failed, or complete.
- Branch navigation preserves history within a session; a fork preserves native Pi format in an
  independent session.

## Configuration and interaction compatibility

Native history is portable between terminal Pi and Pagoda; execution environments are independent.
Configuration changes apply at Pi's supported boundaries or new session creation, without
retargeting existing work.

## Execution authority

Tools run unsandboxed on the host under the user's permissions, without approval gates. The working
directory is not a filesystem boundary.