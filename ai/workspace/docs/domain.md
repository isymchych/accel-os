# Pi workspace domain

## Concepts and ownership

- **Session:** a native Pi conversation, its history tree, active branch, and persisted
  configuration.
- **Working directory:** the local starting context for project resources and tools.
- **Account profile:** an existing `ai/pi/` profile with isolated credentials and shared resources.
- **Desktop session:** an app-owned Pi RPC child and its current observable state.
- **Renderer:** the React view; it observes sessions and sends explicit commands.

Pi owns tools, model access, context management, retries, compaction, queues, history, and session
files. The desktop owns process lifecycle, navigation, drafts, and graphical presentation. `ai/pi/`
remains the source of truth for agent configuration and credentials.

## Activity, outcomes, and connection

Connection and execution are separate. Disconnection does not establish success, failure, or
cancellation; displayed execution becomes unknown until fresh state confirms it.

Prompt acceptance is not completion. A Pi response can mean started, queued, or handled by an
extension. `agent_end` may precede retries or queued work; `agent_settled` marks the end of
automatic continuation. A tool error does not necessarily end the run.

Display command rejection, provider/tool errors, extension failures, and child-process exit
distinctly where the runtime exposes them. Preserve drafts on failed or uncertain submission; do not
automatically retry potentially accepted input.

## Lifecycle

Renderer refresh, hot updates, and view changes end observation, not execution. Reattach using
current main-process state and ignore stale observations. Stop requests Pi cancellation and stays
stopping until Pi confirms it; unknown cancellation is not success.

Quitting the desktop closes its RPC children and their active work. There is no background daemon or
automatic replay/resumption after an app or machine crash. Existing session history remains
reopenable through Pi; reopening history is not recovery of unfinished execution.

Each active session has one execution owner. CLI/GUI handoff is sequential; never open the same
session for concurrent writes. A profile is fixed for the child lifetime; changing the selected
profile for later launches does not retarget existing work.

Session navigation and native Pi branching must preserve original history and target commands to the
explicitly selected session. Follow-up and steering remain distinct, using Pi's native semantics
rather than an application queue.

## Configuration and interaction compatibility

Share configuration and session formats with the terminal launcher, not terminal widgets. Changes
take effect at Pi's native boundaries or the next child launch as appropriate. Do not change
process-global directory or profile environment to retarget another running session.

React renders graphical controls for Pi interactions. Cancel unsupported RPC dialogs explicitly and
display a notice; never silently approve them. Custom terminal UI and tools that disable themselves
outside TUI mode require graphical adaptation.

## Execution authority

Tools run unsandboxed on the host under the user's permissions, without approval gates. The working
directory is not a filesystem boundary. [Architecture](architecture.md#security-and-execution)
defines how the desktop protects the renderer and credentials without restricting tool authority.