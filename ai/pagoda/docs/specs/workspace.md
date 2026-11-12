# Workspace behavior

This is the agreed behavioral contract, including local client boundaries. It describes the target;
current implementation gaps are identified in [architecture](../architecture.md).

## Launch and configuration

`ai ui` starts the local backend with the selected working directory, then opens Electron. Closing
Electron stops the backend and active work. `ai ui --browser` opens the browser instead and keeps
the backend foreground until Ctrl+C. The terminal launcher retains its ordinary argument passthrough
and account selection behavior. Unsupported UI arguments are rejected rather than forwarded to Pi.
Remote access is outside scope.

Execution uses direct, in-process Pi SDK sessions with Pagoda-owned configuration, tools, and
extensions, not the terminal's `ai/pi/runtime` launcher or its extension list. Each execution owner
has an explicit working directory and session configuration; process-global cwd/environment changes
must not retarget another session.

### Shared resources

Load skills from `ai/skills/` and prompt templates from `ai/prompts/`, and append `ai/SYSTEM.md` to
Pi's normal system prompt, as terminal Pi does. Preserve normal project instruction discovery for
each session's working directory. These shared resources do not imply loading terminal extensions or
inheriting their tool selection. Pagoda rejects the terminal's code-navigation selection; terminal
Pi continues to support it.

### Accounts

Expose all existing `ai/pi/profiles/` accounts for selection when Pagoda opens, with email and plan
where available. Availability does not require eagerly creating an execution session per account.
Pagoda has one backend-wide account selection, initially the first discovered account. New sessions
and saved sessions opened with a new execution owner use the selected account. Changing the
selection affects subsequent owners only; existing owners, including their active and queued work,
retain their original account. Reopening an already active session reuses its existing owner.
Changing the selection does not change terminal Pi's selection or write `ai/pi/active-account.json`.
Launching Pagoda does not require selecting a single terminal account.

Reuse the existing per-profile `auth.json` files through SDK credential storage, including
credential refresh writes. Do not copy credentials into Pagoda settings or expose tokens to the
renderer. Login and account creation remain in terminal Pi initially; Pagoda lists and selects
existing accounts rather than adding credential-management UI.

## Session selection and concurrent work

Users can enter validated directory paths and browse, create, and reopen native Pi sessions.
Selecting a session displays its transcript, draft, and activity. Reopening an active session reuses
its execution owner; reopening saved history after its execution owner is disposed creates a new
owner. The Sessions library lists native sessions across working directories in the shared Pi
session store, with search and directory filtering. Session history is not separated by account
profile. Viewing regular terminal history does not require its original extensions; resuming it uses
Pagoda's tools, instructions, and execution configuration rather than recreating its original
environment.

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
semantics. Follow-ups and steering are distinct actions. Model and thinking-level controls use the
selected Pi SDK session's configuration, apply to that idle session, and do not change global
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

Command rejection, provider/tool errors, extension failures, and execution-owner failures remain
distinguishable where Pi exposes them. Agent output is displayed as untrusted content under the
[local client boundaries](#local-client-boundaries).

Pi notifications are displayed. Unsupported extension dialogs receive explicit cancellation and a
visible notice, never silent approval; other presentation-only records are not rendered.

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

## Local client boundaries

The backend binds only to `127.0.0.1`. Validate Host against explicit backend/development origins;
reject foreign Origin and cross-site requests. All API reads, commands, and streams require an
authenticated session, except the credential exchange. Writes require same-origin JSON requests.
There is no permissive CORS or arbitrary shell, filesystem, environment, or credential API.

The connection URL carries a backend-lifetime credential in its fragment. The frontend removes it
and authenticates through an HttpOnly, SameSite=Strict cookie. Do not log the credential beyond
explicit startup output or persist it in app storage. Backend restart invalidates authentication;
reconnect through the new connection URL.

Keep the authenticated image proxy. It fetches HTTP(S) URLs from transcript content without browser
cookies or referrers, including URLs on local networks; it limits response size and duration and
sandboxes successful responses, including when opened directly.

Render agent output as untrusted content; Markdown must not enable raw HTML or executable content.
Keep referrer and cross-origin response policies. Production loads same-origin assets with a
restrictive CSP and same-origin API connections. Development alone loads Vite from explicit loopback
and permits its hot-update connection and injected scripts.

These controls protect the UI boundary, not Pi tools; see
[execution authority](../domain.md#execution-authority).

### Excluded transport policies

Custom slow-observer queue limits and write-deadline eviction, HTTP/RPC request-size limits, and
connection termination for malformed or oversized Pi RPC records are rejected requirements. Do not
preserve or recreate them merely for migration parity. The image proxy's response limits are
retained and are separate from these exclusions. Boundary schema validation and uncertain submission
handling remain unchanged.