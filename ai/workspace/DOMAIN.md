# AI workspace domain

Draft domain model describing agreed target behavior. [VISION.md](VISION.md) defines MVP scope and
longer-term capabilities.

## Core concepts

- **Workspace:** personal control center for agents and their workflows.
- **Client:** web, mobile, or terminal interface that observes state and issues commands.
- **Agent host:** service owning durable conversations and their execution. One machine may host
  several.
- **Execution environment:** filesystem and process context in which tools run.
- **Project:** optional saved working context; initially a canonical local directory.
- **Conversation:** durable transcript and associated configuration, execution context, and optional
  project association. Its identity is independent of its title or route.
- **Agent:** configured participant in a conversation; initially its identity and configuration
  belong to that conversation.
- **Account:** workspace-managed provider login selected for a conversation, with server-side
  credentials and refresh state isolated from other accounts.
- **Agent preset (post-MVP):** reusable model, instructions, tools, and execution configuration.
- **Submission:** admitted input with a durable outcome.
- **Run:** model responses and tool calls progressing from admitted input toward a final answer.

Projects and presets belong to the application; the runtime owns conversations, submissions, and
runs. [ARCHITECTURE.md](ARCHITECTURE.md#runtime-terms-and-state) maps these concepts to runtime
records.

## Ownership and execution context

Hosts own conversations and execution; clients observe and issue commands. Admitted work continues
under host execution policy across client disconnections. Observation, execution, and administration
each require explicit authority. The [MVP execution policy](VISION.md#agreed-mvp-decisions) defines
unsandboxed access.

Users choose directories directly or through projects. Paths resolve in their owning execution
environment. Conversations may run concurrently in the same project or directory; users coordinate
overlapping work themselves.

Execution requires explicit authority independently of capability selection.

## Activity, outcomes, and connection

Execution, submission outcome, and client connection are independent:

- **Execution:** idle or running, with blocked work distinguished from normal progress.
- **Submission:** pending until answered or unanswered, with a reason for unanswered input.
  Cancellation has its own reason within unanswered outcomes, distinct from provider failure.
- **Connection:** connecting, connected, or disconnected. While disconnected, execution state is
  last-observed information; a fresh observation confirms current state.

Runs may finish while clients are disconnected. Command completion requires confirmation from the
execution owner.

Distinguish provider failure, tool failure, interrupted execution, unavailable or invalid
configuration, and client transport failure. A tool may fail while its run continues. Provide
readily visible explanations for unanswered input and blocked work. Preserve failures and useful
explanations for unknown reasons. Report success after confirmation from the execution owner. Treat
a lost stream as a connection error; establish execution outcomes from runtime state.

## Configuration safety

Changes to model, instructions, tools, and execution context apply to subsequent work. Admitted work
keeps its resolved configuration, including during concurrent submissions and configuration changes.
Presentation-only changes may take effect immediately.

Each conversation selects an account independently; different conversations may use different
accounts concurrently. Admitted work retains its resolved account. Post-MVP account switching
changes the account for subsequent submissions without changing conversation identity. A new branch
uses the currently selected account, even when branching from a point before an account switch;
historical transcript state does not restore an earlier account selection. Switching and branching
are not MVP interactions.

When presets enter scope, applying one resolves concrete configuration for the conversation. Later
preset edits affect future applications; existing configurations retain their resolved values.

Running work retains its resolved configuration across host-default, registry, and project edits.
Inherited execution choices resolve explicitly where needed. A conversation keeps its configured
directory when a saved project's path changes; applying another directory is explicit.

## Work lifecycle

Each logical submission produces at most one input, including retries. While busy, offer an explicit
follow-up action queued after the active run. Keep follow-up and steering as distinct actions.

Closing a tab, changing routes, or disconnecting leaves work running. Stop cancels the active run
and terminates its owned processes, including foreground commands. Work remains stopping until the
runtime confirms idle. Preserve queued input without starting it until the user explicitly resumes
execution. This stopped state survives disconnection and server restart; automatic recovery does not
resume user-stopped queues.

After a server restart, automatically recover eligible unfinished work independently of client
connections, respecting user-stopped queues and upstream tool replay policies. Require evidence
before declaring a tool replay-safe. Show interrupted calls and committed partial output in the
conversation, and instruct the agent to inspect actual state before retrying uncertain side effects.
Recovery does not require blanket human approval or a dedicated recovery dashboard.

Runtime replay prevention does not prevent an agent from issuing a new equivalent command.
Inspection instructions reduce risk but do not guarantee exactly-once external effects. Show
actionable diagnostics when missing configuration, credentials, or other execution problems
genuinely block progress.