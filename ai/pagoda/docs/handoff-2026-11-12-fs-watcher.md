# Handoff: filesystem-driven freshness

## Goal and authorization

Continue discussion of whether a backend filesystem watcher should refresh shared Pagoda metadata
and native session listings automatically. The user asked whether watchers would be useful more
generally for watching/presenting session changes.

Watcher work is **discussion/design only**: no implementation or final design has been approved.
This handoff and the concurrency caveat described below are the only edits authorized in this
conversation. Recommendations below are not permission to implement.

Workspace: `ai/pagoda/` within the accel-os repository. Follow its `AGENTS.md` and the root
guidance. Read `docs/domain.md` and `docs/specs/workspace.md` before behavior changes, and
`docs/architecture.md` before integration changes.

## Accepted decisions and current progress

- User prefers simplicity and explicitly does not want to overengineer rare metadata collisions.
- Keep the existing JSON metadata approach for now. Do not introduce SQLite or cross-process locking
  merely to prevent occasional simultaneous pin/favourite updates.
- At the user's request, added this caveat to `docs/specs/workspace.md`, beside shared metadata:
  separate backends share persisted pins/favourites without live synchronization, and simultaneous
  edits can lose changes; this low-frequency risk is accepted.
- That caveat is an **unstaged** edit atop an already staged modification to the spec (`MM`).
  Preserve both layers. No changes were staged or committed by this agent.
- A larger set of pre-existing staged changes implements session-library/sidebar metadata work,
  spanning Pagoda, Pi runtime bridges, tests, and repository guidance. Use the staged diff as the
  durable record; do not reconstruct or overwrite it.
- No watcher code was added. No application checks were run in this discussion. `git diff --check`
  passed after the caveat edit; that is only a whitespace check.

## Observed implementation and implications

These conclusions come from local source inspection, not runtime concurrency tests:

- `src/backend/entry.ts` configures shared `ai/pi/pagoda-state.json` and
  `ai/pi/pagoda-settings.json`.
- `src/backend/session-metadata.ts`: `SessionMetadataStore.list()` reads and validates disk state on
  every call. `update()` already re-reads before modifying a flag and directly overwrites JSON with
  `writeFileSync`.
- Thus sequential writes see previous changes, but separate processes can both read old state and
  overwrite each other's updates. Synchronous calls serialize only within a process. Direct writes
  can also expose incomplete JSON to another reader. Neither risk was reproduced here.
- `src/backend/workspace.ts`: `setMetadataFlag()` writes and calls `publishMetadata()`.
  `subscribeMetadata()` listeners are backend-local.
- `src/backend/events.ts` sends metadata SSE events; the renderer consumes them in
  `src/renderer/use-workspace-observation.ts`. There is no cross-backend notification mechanism in
  the inspected flow.
- `DesktopWorkspace.list()` / `listAll()` discover native sessions through a connected Pi child.
  Relevant bridge files are `../pi/runtime/desktop-extension.ts` and
  `../pi/runtime/desktop-sessions.ts`. Their filesystem/storage details still need focused
  inspection before choosing watch roots or refresh costs.
- Reopen deduplication in `DesktopWorkspace.open()` is backend-local. Metadata watching would not
  prevent multiple backends writing the same native conversation.

## Proposed direction, not accepted requirements

The last recommendation was a small backend-owned invalidation mechanism, not a generic filesystem
framework:

1. Watch relevant containing directories rather than individual files, so file replacement does not
   leave an individual-file watch attached to an old inode. Validate actual Node/Linux watcher
   behavior and the native store layout before implementation.
2. Treat events as hints: debounce/coalesce bursts, then re-read through existing APIs rather than
   interpreting events as a complete or precise change log.
3. For Pagoda metadata changes, re-read and publish metadata only when its value differs. Preserve
   immediate notifications for writes made through that backend.
4. For native session creation/update/deletion, invalidate the catalog and refresh visible session
   lists. Avoid rescanning all session history for every streaming write.
5. Keep RPC authoritative for currently executing sessions' transcript and execution state. Do not
   infer running/finished state from filesystem changes.
6. Use one watcher owner per backend with shutdown cleanup. Preserve explicit Refresh.
7. Keep concurrent external-session editing out of scope. Live presentation of an externally running
   transcript is a separate, larger decision, not implied by catalog freshness.

Earlier, polling every few seconds while clients are connected was suggested for metadata alone:
re-read, compare with last published state, emit the existing SSE event, and stop polling with no
observers. That remains a simple alternative if broader session watching is not useful enough. The
watcher recommendation arose only after the user expanded the discussion to session changes. Neither
watching nor polling prevents the accepted simultaneous-write collision.

## Open decisions and next action

First clarify what "presenting session changes" means: automatic catalog/sidebar freshness, or live
viewing of a conversation running outside this backend. Recommend starting with catalog plus
metadata freshness only; obtain scoped implementation authorization before editing behavior.

If that direction is chosen, inspect only the native discovery/store boundary and existing
observation lifecycle to determine watch roots, directory coverage, invalidation delivery, refresh
cost, observer lifetime, and error handling. No conclusions about recursive watching support, needed
dependencies, or missed-event recovery have been established.

For an authorized implementation, proposed verification targets are cross-backend metadata
notification, external session catalog changes, coalescing of write bursts, unchanged-state
suppression, and shutdown cleanup. Test design and exact checks are still undecided; use existing
coverage in `tests/integration/session-metadata.test.ts`,
`tests/integration/workspace-observation.test.ts`, `tests/integration/workspace.test.ts`, and
`tests/e2e/browser.spec.ts` where suitable. Follow `docs/development.md` for safe execution.

Durable contract: `docs/specs/workspace.md` currently requires explicit catalog refresh for outside
activity and records the accepted cross-backend metadata limitation. If watcher behavior is approved
and implemented, update only the guidance it actually changes.