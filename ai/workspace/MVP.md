# AI workspace MVP implementation

Implementation contract for the [initial scope](VISION.md#initial-scope), with recorded evidence and
remaining checks distinguished below. [DOMAIN.md](DOMAIN.md) owns behavioral rules;
[ARCHITECTURE.md](ARCHITECTURE.md) owns system structure and technical boundaries. Runtime
integration remains proposed where noted. References to deferred capabilities describe later scope;
adding them to the MVP requires an explicit decision.

## Runtime integration

Expose create/reopen, state reads, configuration changes, submission with request ID, cancellation,
and committed-snapshot watches through `server/runtime/`. It owns harness lookup and returns
application-owned results. Submission success confirms durable acceptance. Runtime state confirms
completion and idle after cancellation.

- Use Durable coding tools and `NodeExecutionEnv` for host files and shell execution; verify process
  termination against the Stop contract.
- Evaluate `ModelRuntime` as the direct bridge from existing `ai/` model and credential
  configuration; operational compatibility is still unverified.

Verify configuration isolation through every runtime task phase, including agent and environment
resolution. Allow configuration editing while preserving running execution context. For changes
limited by the pinned runtime's context-preservation capabilities, require confirmed idle and
document the limitation.

### ModelRuntime integration status

Recorded source-level findings from installed Pi 1.3.0 declarations and local upstream source at
`482c1381a00d8d00bc81697e4a980c593db6803e` (also 1.3.0):

- `ModelRuntime` implements `Models`, accepted by Durable's `HarnessOptions.models`, and appears
  compatible with direct integration.
- `ModelRuntime.create()` accepts credential/model paths. Existing
  `ai/pi/runtime/account-profiles.ts` uses profile-specific `auth.json` and shared `models.json`.
- Pi OAuth refresh locks the credential store's read-modify-write operation, rechecks freshness, and
  persists rotated credentials before unlocking.

Durable is installed as an exact workspace dependency. Recorded workspace typechecking and imports
of Durable and its Node SQLite adapter passed. Direct `ModelRuntime` execution through Durable
remains to be verified.

The remaining bounded check uses fake providers and isolated temporary credentials:

1. Complete a Durable response with `ModelRuntime` directly.
2. Verify profile isolation and stable existing-session binding when the CLI's active account
   changes.
3. Refresh concurrently from separate processes sharing a temporary auth file; verify reuse of fresh
   credentials and preservation of rotated tokens.
4. Verify clear authentication failures and preservation of refreshed credentials during
   cancellation.

Identify CLI model defaults and provider-extension behavior that need explicit wiring alongside
`ModelRuntime`. Production integration and account-selection changes require separate authorization.

## Configuration and persistence

### Runtime SQLite persistence

Use `openNodeSqliteStorage` from `@earendil-works/pi-durable/storage/sqlite/node`, with one database
per independent session/harness. It contains the main conversation, related subagent conversations,
and tasks. Store it at `sessions/<session-id>.sqlite` under a private user-data directory outside
the repository; choose the root and backup procedure during implementation.

Enforce the [single-owner and schema boundaries](ARCHITECTURE.md#runtime-sqlite-persistence) before
opening a harness.

The Node adapter defaults to WAL with `synchronous = NORMAL`: ordinary process crashes are covered,
but power or host failure may lose recent commits. Verify the pinned settings and document the
chosen synchronization policy, including its power-loss guarantees and limitations.

Measure database/WAL growth, memory use, and reopen time with representative streaming and tool
output. If they exceed the operational budget, investigate supported upstream maintenance or storage
options. Keep runtime maintenance within supported upstream APIs.

Back up complete session storage while its harness is closed, together with application
configuration. Include remaining WAL files and verify restoration into a separate directory with the
pinned runtime. Configuration and runtime state remain independently persisted in this backup.

### Application JSON persistence

Store `preferences.json`, `projects.json`, and `agent-presets.json` separately in the private
user-data directory. Each has a `schemaVersion` identifying its persisted shape. Define schemas and
derived types beside the server persistence owner; expose only needed fields through HTTP contracts.

- The backend owns writes. Manual edits require a stopped server; live watching and merging remain
  later scope.
- Validate through the canonical JSON helper. Missing files may initialize defaults; malformed or
  invalid files stay intact and produce actionable errors.
- Read the version before choosing a schema. Preserve files with newer versions and report an
  unsupported-version error. Validate supported older shapes, migrate sequentially, then validate
  the current shape before saving. Add historical schemas and migrations only for actual schema
  changes.
- Serialize the whole read-modify-write operation. Validate before saving and acknowledge only after
  persistence succeeds; failed saves retain the previous in-memory state.
- Write a temporary file beside the destination, replace by rename, and clean up failures. Define
  power-loss durability through explicit flushing and backup requirements alongside rename. Preserve
  a restorable copy before migration.
- Store credential references, never secrets.

## Commands and live state

### Routing and HTTP state

Add routing for multiple screens, with typed parameters and validated URL search state. Routes
identify the conversation and optional project; keep navigation and reload-recovery state in the
URL. Thin route modules compose feature screens and coordinate loading.

Features own ordinary reads and loading/error state through Solid; `client/lib/api.ts` supplies Hono
RPC. Set freshness and refresh behavior deliberately if using route loaders. Keep ordinary reads
separate from live snapshots.

Send commands through explicit feature actions. Track pending/error feedback in Solid. After
configuration changes, refresh affected reads while preserving drafts. Preserve drafts through
recoverable failures. Runtime state confirms execution completion.

Start with Solid state for reads and command feedback. Adopt an established query library when
shared refreshed data, pagination, or repeated mutation/cache coordination creates concrete
complexity.

### Submission

1. The client creates a request ID for one logical submission.
2. The server validates input and applies feature policy.
3. The runtime durably admits the submission before HTTP success.
4. The client observes committed progress through SSE.

Retain the ID across ambiguous HTTP failures; define its scope and reject reuse with different
content. Newly composed input gets a new ID. Do not indiscriminately retry non-idempotent actions.
[Explicit follow-ups](DOMAIN.md#work-lifecycle) use Durable's inbox, which owns the queue and
placement after the active run. Show queued input separately from active execution.

### Streaming

Start with complete application-owned conversation snapshots over SSE, normalized from Durable's
committed-state watch in `server/runtime/` into the browser protocol.

One feature subscription owns the active conversation's snapshot and connection state and shares
them with child components. Start with an initial snapshot and replace it with newer snapshots.
Ordinary reads and command responses update their own state; the subscription exclusively updates
the live snapshot.

Bound pending output per connection and coalesce superseded snapshots for slow readers. Dispose
server watches on disconnect and client subscriptions on conversation change or unmount. Reconnect
starts a fresh stream generation; accept callbacks exclusively from that generation and show
stale/disconnected state until a fresh snapshot arrives.

Full snapshots favor a simple client over bandwidth efficiency. If transcript/output serialization
materially hurts responsiveness or memory, add bounded paging or application-owned deltas with
snapshot recovery, based on measurements.

### Work view

The read-only MVP work view derives running, waiting, and blocked work from committed task graphs,
inspection results, and submission records. Show ownership, pending submissions, and reasons for
blocked or interrupted work. Broader capability and effective-configuration inspection is future
direction. Apply observation permissions and exclude credentials and sensitive configuration;
execution requires its own authority. A future agent-callable inspection tool should share the
browser panel's inspection service.

Use the runtime's inspection and history directly for MVP observability.

### Frontend integration

Accessibility work requires a separate scope decision.

`client/styles/theme.css` owns semantic CSS variables and Tailwind mappings: `@theme` produces
utilities; `@theme inline` references variables. Light and dark themes share token names. Persist
explicit overrides in application preferences.

`client/ui/` owns domain-free primitives and finite typed size/emphasis variants. Features own
terminology, state, and compositions; promote only shared domain-free compositions. Keep imports
explicit. Add providers, styling engines, and wrappers for concrete needs. Keep primitives in this
package, use feature-owned state initially, and integrate capabilities directly.

Follow [DESIGN.md](DESIGN.md) for presentation and [AGENTS.md](AGENTS.md#ui-primitives) for
component conventions. Import Lucide directly through a Solid 2-compatible integration. Validate
patterns in feature screens. Add a gallery/Storybook when feature examples need dedicated tooling.

## Recovery and cancellation

Implement the [domain lifecycle](DOMAIN.md#work-lifecycle) through Durable. Disconnect or an aborted
HTTP wait disposes observation while execution continues. Graceful server shutdown closes observers
and runtime resources; user Stop follows its own cancellation contract.

At startup, discover unfinished sessions and resume eligible work once definitions and execution
environments are ready, independently of browser connections. An option to disable recovery remains
an operational decision. Require evidence for replay-safe tool declarations; surface interrupted
unsafe tools for review before replay.

## Open decisions

Resolve data location, backup procedure, SQLite synchronization, and request/output limits in their
owning implementations. Verify credential reuse and refresh alongside CLI sessions. Document chosen
limits; escalate only when evidence requires a product tradeoff or architecture change.

## Acceptance checks

### Integration checks

These criteria define verification for their corresponding capabilities when in scope. Track
completion through actual check results. Use an exact runtime version, fake providers, harmless
tools, and isolated temporary state.

- **Runtime:** submit, watch, retry, Stop, close/reopen, and abrupt-exit recovery. Verify session
  isolation, single database ownership, chosen synchronization policy, closed-harness backup and
  restore, and representative database/WAL growth, memory, and reopen time. Process-exit tests cover
  process crashes; power-loss durability requires separate evidence.
- **Transport:** TypeBox/canonical JSON through Hono RPC to Solid, valid/invalid inputs, error
  narrowing, and browser bundle boundaries. A lost submission response followed by retry creates one
  input. Check reconnect convergence, cancellation to idle, bounded slow-reader output, observer
  cleanup, and stale callback/late response rejection. Reads and commands preserve drafts and the
  stream-owned snapshot.
- **Security and UI:** reject hostile hosts/origins, traversal, mismatched request IDs, and
  oversized input. Verify safe Markdown, error/disconnection feedback, primitive variants, control
  interactions, dismissal, and long content in both themes and narrow/wide feature screens.
- **Application state:** for each file, verify initialization, round trips, invalid-file
  preservation, newer-version rejection, concurrent updates, failed-save isolation, and
  missing-project errors. Test historical migrations when historical schemas exist.
- **Configuration and lifecycle:** preset snapshotting, stable context during concurrent
  submissions/configuration changes, and idle guards for runtime-limited changes. Stop terminates
  owned processes and waits for confirmed idle; startup recovery runs independently of browser
  connections. Outcomes stay independent of connection state; tool failures may leave runs active.
  Verify safe failure/blocked summaries, follow-ups through the runtime inbox, and task
  ownership/waiting/blocked reasons in the work view. Disconnected state shows the last observation;
  a fresh observation confirms current state. File edits and shell commands execute directly under
  the MVP's unsandboxed host policy.

### Test isolation and browser coverage

Use Node's test runner for server/contracts where sufficient, Playwright for E2E, and separate
component tooling when focused interaction checks require it. Live model calls require explicitly
invoked manual smoke checks.

Tests use synthetic state and fake provider credentials exclusively. Give each test its own writable
runtime directory and clean up processes and temporary data.

As runtime integration is added, browser journeys in `tests/e2e/`, configured by
`playwright.config.ts`, exercise the real frontend, routes, SSE, and runtime with a deterministic
fake model and isolated JSON/SQLite state. Use Playwright's local-server support and verify
readiness of the test instance. Connect exclusively to that test instance. Use separate
ports/storage for concurrent instances or serialize the suite until isolation exists.

Cover directory/project selection, conversation navigation, submit-to-stream-to-Stop,
reload/reconnect preserving committed state, and core controls. Use role/label locators to assert
visible outcomes, and synchronize checks through retrying assertions. Keep abrupt-exit, malformed
persistence, and detailed failure injection in Node integration tests; browser journeys focus on
cross-system behavior.

Keep workspace operations in its `Justfile` and use
[system Chromium](DECISIONS.md#adr-001-use-system-chromium-for-e2e). [README.md](README.md) owns
commands and browser configuration. Preserve root workspace registration, formatter/lint scopes, and
browser-specific lint environments. Keep repository orchestration in `Justfile`.