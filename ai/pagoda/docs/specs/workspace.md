# Workspace behavior

## Launch and configuration

`ai ui` starts the local backend with the selected account profile, working directory, and
code-navigation choice, then opens Electron. Closing Electron stops the backend and active work.
`ai ui --browser` opens the browser instead and keeps the backend foreground until Ctrl+C. The
terminal launcher retains its ordinary argument passthrough and account selection behavior.
Unsupported UI arguments are rejected rather than forwarded to Pi. Remote access is outside scope.

Execution uses the canonical Pi RPC entry and existing configuration, credentials, resources, and
session storage. Each child keeps its own directory and profile environment; process-global changes
must not retarget another session.

## Session selection and concurrent work

Users can enter validated directory paths and browse, create, and reopen native Pi sessions.
Selecting a session displays its transcript, draft, and activity. Reopening an active session reuses
its execution owner; reopening saved history after child exit creates a new owner. The Sessions
library lists native sessions across working directories in the shared Pi session store, with search
and directory filtering. The selected account supplies execution credentials when a session is
reopened; session history is not separated by account profile.

The sidebar shows pinned sessions and recently active sessions. Recent uses native Pi session
activity, including work performed in the CLI; reopening history alone does not renew it. Refresh
the catalog to see activity from outside Pagoda. An unpinned session leaves Recent after the
configured inactivity period, except while selected, executing, stopping, execution is unknown, or
the client has an unsent draft. Aging out neither deletes history nor stops work. Pinning keeps a
session in the sidebar; favouriting makes it filterable in Sessions without pinning it. Pins and
favourites are shared across clients and account profiles. `ai/pi/pagoda-settings.json` sets
`sidebar.inactivityHours`; its default is 48 hours.

Separate Pagoda backends share persisted pins and favourites but do not synchronize live updates.
Simultaneous metadata edits across backends may lose changes; this low-frequency risk is accepted.

Work continues independently across sessions. Starting work in A, switching to B and submitting
there, then returning to A preserves each session's history, draft, and activity. Commands remain
attached to the session where they originated, including while Send or Stop confirmation is pending.

Terminal/Pagoda handoff is sequential: close the terminal session before opening it through Pagoda,
and stop its backend before resuming the session in the terminal. Browser and Electron clients share
execution owners, while their drafts and selections remain independent.

## Input, follow-ups, and steering

Users can submit input, queue explicit follow-ups, and steer active work using Pi's native
semantics. Follow-ups and steering are distinct actions. Model and thinking-level controls use Pi's
existing configuration and runtime, apply to the selected idle session, and do not change global
defaults. When idle, follow-up and steering both start work immediately.

Drafts and pending commands stay with their originating session across view changes and page
reloads. Rejected or uncertain submissions retain the draft. A lost command response leaves
submission uncertain; input must not be resent automatically.

## Transcript and activity

Sessions display history, streaming text, meaningful tool activity and results, connection and
execution state, errors, and interaction notices. Long text and tool results expand on demand.
Collapsed previews preserve complete content without cutting Markdown syntax. User and assistant
messages render Markdown; tool arguments and ordinary tool output remain literal. Markdown images
and native message/tool images are displayed in content order. Thinking streams in collapsible
sections at its original position and remains available in completed messages and reopened history.
Transient streaming updates coalesce; completed messages and lifecycle changes appear immediately.

Command rejection, provider/tool errors, extension failures, and child exit remain distinguishable
where Pi exposes them. Agent output is displayed as untrusted content under the
[rendering and security boundaries](../architecture.md#security-and-execution).

Pi notifications are displayed. Unsupported RPC dialogs receive explicit cancellation and a visible
notice, never silent approval; other presentation-only records are not rendered.

## History navigation and forks

Users can read conversation history and navigate native branches while the session is idle.
Navigation preserves the original history. Selecting a user message other than the current leaf
navigates to its parent and restores its text to the composer; selecting the current leaf is a
no-op.

Forking creates an independent native session containing persisted history through the selected
entry. The source retains its history and continues active work; unfinished streaming output is
excluded from the fork. Fork creation must not invoke runtime fork hooks or let legacy migrations
rewrite the live source.

The fork can execute independently while its source continues streaming.

## Stop, reconnect, and application lifetime

Stop targets the session where it was requested, even if the selected view changes while
confirmation is pending. It remains stopping until Pi confirms cancellation; an unknown outcome must
not be displayed as successful cancellation.

Page refresh, hot updates, view changes, and closing browser tabs preserve active execution. Closing
the launcher-owned Electron window stops the backend. Reconnection displays current state and
ignores stale observations. Lost connectivity makes execution unknown, not cancelled or failed.

Stopping the backend ends active Pi work even while clients remain connected. Persisted history
remains reopenable after a backend or machine crash; unfinished execution requires a fresh run.