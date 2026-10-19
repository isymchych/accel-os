# AI workspace domain

Status: draft. Agreed direction unless marked proposed; distributed capabilities remain future
scope.

## Glossary

| Term                  | Meaning and owner                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace             | Application for observing, coordinating, and managing agent work.                                                                                   |
| Client                | Web, mobile, or terminal interface that observes state and issues commands.                                                                         |
| Constellation         | Collection of registered agent hosts visible through a workspace, with explicit observation and control permissions.                                |
| Agent host            | Service that owns Durable harnesses, their persistent state, and execution lifecycle. A machine may host multiple such services.                    |
| Execution environment | Filesystem and process context in which tools operate, such as a host directory, container, VM, or remote environment.                              |
| Project               | Application-owned registration of a working context in an execution environment; initially a canonical directory on the local host.                 |
| Agent                 | User-facing name for the configured participant in a conversation. Initially its identity and configuration belong to that conversation.            |
| Agent preset          | Application-owned reusable model, instructions, tools, and execution configuration, resolved into concrete conversation configuration when applied. |
| Conversation          | Harness-owned durable transcript and associated documents, identified by its runtime ID and linked to a registered project.                         |
| Submission            | Harness-owned record of admitted input or a write. The first slice exposes user input, with a request ID for retry deduplication.                   |
| Run                   | Sequence of model turns and tool calls from admitted input toward a final answer, represented by harness state.                                     |
| Turn                  | One model response and its tool calls.                                                                                                              |
| Task                  | Durable checkpointed unit of execution used for generation, tools, and execution diagnostics.                                                       |

Use **run** for the domain concept and **execution** for the general activity. A future requirement
for agent identity across conversations, such as a named scheduled maintenance agent, would justify
a separate agent entity.

Runtime concepts follow the upstream definitions; projects and presets are application-owned.
Preserve runtime IDs rather than identifying conversations by route or display title.

## Activity, outcomes, and connection

Keep these dimensions independent:

| Dimension          | Presentation contract                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution activity | Derive idle/running from committed harness state. Surface blocked work explicitly, not as normal progress.                                                                                  |
| Submission outcome | Pending while unsettled, answered when the runtime reports `done`, and unanswered with its reason when it reports `unanswered`. Cancellation is a reason, not an ordinary provider failure. |
| Browser connection | Connecting, connected, or disconnected; this describes observation, not whether work exists. Disconnected execution information is last observed, not current confirmation.                 |

An input moves from admission to pending and then an answered/unanswered outcome. A run can finish
while the browser is disconnected. These labels describe runtime state, not a new application-owned
state machine.

## Host ownership and authority

Agent hosts own durable conversations and execution; clients observe state and issue commands.
Observation, execution, and administration each require explicit authority. Hosts continue admitted
work within their execution policy while clients are disconnected. Scheduling new work, spawning
agents, and provisioning resources require separately defined permissions.

Keep host identity stable across client connections and restarts. Resolve project paths within their
owning execution environment. Host observations carry connection status and last-observed state;
command completion requires confirmation from the execution owner.

Conversation identity and durable state survive environment suspension; retained artifacts follow an
explicit persistence policy. Waking suspended compute requires an external wake mechanism.

## Capabilities and conversation selection

Model product capabilities as application-owned features with flags or toggles, not user-facing
extensions. Runtime extensions are an internal integration mechanism, not an application plugin
framework.

Keep feature availability, per-conversation selection, and execution authority separate.
Availability controls which capabilities the application exposes; conversation configuration selects
among those capabilities. Enabling a feature does not grant permission to execute its actions.
Feature services enforce these distinctions on the backend.

## Configuration safety

Resolve a selected preset into concrete conversation configuration when it is applied. Later preset
edits affect future applications, not conversations already configured from that preset. The
effective configuration belongs to the conversation, not merely a reference to a mutable preset.

Reject changes to a busy conversation's model, instructions, tools/extensions, and working
directory, including under concurrent submissions. Stop does not unlock configuration until the
harness confirms idle.

Feature toggles that alter tools, instructions, or execution context follow the same idle-only rule.
Presentation-only toggles may change immediately.

Do not hot-reload host defaults or registry definitions that alter affected busy conversations.
Resolve inherited execution choices explicitly where needed to uphold the same rule. Changing a
registered project's path must not silently retarget a configured conversation; applying the new
execution directory is an explicit idle-only change.

These rules prevent work prepared for one project or tool policy from executing under another.
Idle-time reconfiguration is supported; live reconfiguration needs an explicit product requirement.

## Submission and stopping

Retries of the same logical submission must not create another input. Reuse its request ID when
admission is uncertain; newly composed input gets a new ID.

Proposed first busy policy: reject new input while a conversation is busy. Do not silently queue or
steer. Revisit this when the UI explicitly supports follow-up or steering semantics.

Changing routes, closing a tab, or aborting an HTTP wait detaches observation, not execution. Stop
is an explicit command; show stopping until the runtime confirms idle. Graceful server shutdown is
not a user Stop action.

Proposed Stop semantics include cancellation of the active run and its owned foreground work.
Background work is deferred until its cancellation policy is designed.

Restart resumes eligible pending work once definitions and execution environments are ready.
Unavailable definitions or credentials produce visible diagnostics rather than indefinite apparent
activity. Recovery never means exactly-once external side effects; interrupted unsafe tools must be
surfaced for review instead of blindly rerun.

## Failure meaning

Distinguish provider failure, tool failure, interrupted execution, invalid/unavailable
configuration, and browser transport failure. A tool can fail while its run continues. Preserve
cancellation as an explicit outcome, not an ordinary provider failure. Unknown runtime reasons need
a useful fallback, not discarded failures or claimed success.

A user should understand why input went unanswered or work is blocked without inspecting the entire
transcript. Losing the stream is a connection error, not evidence of execution failure.