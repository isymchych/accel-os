# Workspace behavior

## Launch and configuration

`ai ui` opens the built desktop with the selected account profile, working directory, and
code-navigation choice. It uses the canonical Pi RPC entry and Pi-owned configuration, credentials,
resources, and session storage. The terminal launcher retains its ordinary argument passthrough and
account selection behavior.

The desktop receives launch selections without changing terminal launcher configuration. Unsupported
UI arguments are rejected rather than forwarded to Pi.

## Conversation selection and concurrent work

Users can choose directories and browse, create, and reopen native Pi sessions. Selecting a
conversation displays its transcript, draft, and activity. Reopening an active session reuses its
existing execution owner.

Work continues independently across conversations. Starting work in A, switching to B and submitting
there, then returning to A preserves each conversation's history, draft, and activity. Commands
remain attached to the conversation where they originated, including while Send or Stop confirmation
is pending.

Terminal/desktop handoff is sequential: close a session in one interface before opening it in the
other. Each session has one writer.

## Input, follow-ups, and steering

Users can submit input, queue explicit follow-ups, and steer active work using Pi's native
semantics. Follow-ups and steering are distinct actions. Model and thinking-level controls use Pi's
existing configuration and runtime.

Rejected or uncertain submissions retain the draft. A lost command response leaves submission
uncertain; input must not be resent automatically.

## Transcript and activity

Conversations display history, streaming text, meaningful tool activity and results, connection and
execution state, errors, and interaction notices. Long text and tool results expand on demand.
Transient streaming updates coalesce; completed messages and lifecycle changes appear immediately.

Command rejection, provider/tool errors, extension failures, and child exit remain distinguishable
where Pi exposes them. Disconnection leaves execution unknown until fresh state confirms its
outcome. Agent output is displayed as untrusted text.

Unsupported RPC dialogs receive explicit cancellation and a visible notice.

## History navigation and forks

Users can read persisted history and navigate native branches while the session is idle. Navigation
preserves the original history.

Forking creates an independent native session containing persisted history through the selected
entry. The source retains its history and continues active work; unfinished streaming output is
excluded from the fork. Snapshot creation must not invoke runtime fork hooks or let legacy
migrations rewrite the live source.

The fork can execute independently while its source continues streaming.

## Stop, reconnect, and application lifetime

Stop targets the conversation where it was requested, even if the selected view changes while
confirmation is pending. It remains stopping until Pi confirms cancellation; an unknown outcome must
not be displayed as successful cancellation.

Renderer refresh and view changes preserve active execution. Reattachment displays current
main-process state and ignores stale observations.

Application quit closes Pi children and their active work. Persisted history remains reopenable
after an application or machine crash; unfinished execution requires a fresh run.