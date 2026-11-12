# Pagoda domain

## Concepts and ownership

- **Session:** a Pi session with its history tree, active branch, and persisted configuration.
- **History entry:** a node in a session's persisted history tree.
- **Branch:** a path through that tree; navigation changes the active branch within the same
  session.
- **Fork:** a new, independent session copied from persisted history through a selected entry.
- **Working directory:** the local starting context for project resources and tools.
- **Account profile:** an existing `ai/pi/` profile with isolated credentials. Pagoda's global
  selection supplies the account for new execution owners, independently of terminal Pi's active
  profile; each existing owner retains its original account.

The workspace is the app's collection of open sessions.

Pi owns agent execution machinery, model access, context management, retries, compaction, queues,
native history, and session files. Pagoda owns its execution configuration, tool/extension
selection, SDK session lifecycle, and shared presentation state; each client owns navigation,
drafts, and graphical presentation. Pagoda reuses terminal Pi's credential files and shared skills,
prompts, and system instructions, without inheriting terminal account switching or extension
selection. The [workspace specification](specs/workspace.md#launch-and-configuration) owns resource
loading and account-switching behavior.

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

Native history compatibility does not imply the same execution environment. Viewing terminal history
does not require its original extensions; continuing it uses Pagoda's available tools and
instructions. Pagoda does not promise to reproduce terminal-only behavior or load terminal
extensions. Configuration changes apply at Pi's supported boundaries or new session creation,
without retargeting existing work.

## Execution authority

Tools run unsandboxed on the host under the user's permissions, without approval gates. The working
directory is not a filesystem boundary. [Architecture](architecture.md#security-and-execution)
defines how the backend and shell protect clients and credentials without restricting tool
authority.