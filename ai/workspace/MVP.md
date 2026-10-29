# AI workspace MVP

First-release contract for the [initial scope](VISION.md#initial-scope). [DOMAIN.md](DOMAIN.md) owns
behavioral rules; [ARCHITECTURE.md](ARCHITECTURE.md) owns system structure and technical boundaries.
Acceptance checks establish readiness for the agreed direction. References to deferred capabilities
describe later scope; adding them to the MVP requires an explicit decision.

## Runtime integration

Expose create/reopen, forking, history and branch reads, in-scope configuration changes, submission
with request ID, Stop, and committed-snapshot watches through `server/runtime/`. It owns harness
lookup and returns application-owned results. Submission success confirms durable acceptance.
Runtime state confirms completion and termination after cancellation. Account switching remains
post-MVP.

- Use Durable coding tools and `NodeExecutionEnv` for host files and shell execution; verify process
  termination against the Stop contract.
- Supply Durable's model access through a configured `pi-ai` `Models` collection.

Verify configuration isolation through every runtime task phase, including agent and environment
resolution. Allow configuration editing while preserving running execution context. For changes
limited by the pinned runtime's context-preservation capabilities, require confirmed idle and
document the limitation.

### Models and credentials

MVP supports OpenAI login through `pi-ai`, with multiple accounts available concurrently and an
account selected for each conversation. Use the supported OpenAI provider and model catalog. Other
providers, custom endpoints, and general multi-provider configuration are post-MVP.

Workspace configuration owns model defaults, account selection, and credential references. Different
conversations must be able to execute simultaneously using different accounts without changing a
global active login. Resolve these choices consistently with the
[configuration safety rules](DOMAIN.md#configuration-safety).

Keep credential sources server-side. Supply workspace-owned credential persistence through
`CredentialStore`, with serialized read-modify-write operations and isolated credentials and refresh
state per account. Preserve other credentials when updating one account.

Let `pi-ai` coordinate OAuth refresh through the store. Concurrent requests reuse refreshed
credentials, and cancellation preserves rotated tokens. Surface authentication and persistence
failures as actionable diagnostics.

Changing an existing conversation's account is post-MVP. Keep account selection independent of
conversation identity and historical transcript state. MVP forks use the currently selected account
under the [configuration safety rules](DOMAIN.md#configuration-safety); future account switching
follows those same rules. A browser credential-management interface is optional.

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

Store `preferences.json` and `projects.json` separately in the private user-data directory. Each has
a `schemaVersion` identifying its persisted shape. Define schemas and derived types beside the
server persistence owner; expose only needed fields through HTTP contracts. Preset storage and
schemas are post-MVP.

- The backend owns writes. Manual edits require a stopped server; live watching and merging remain
  later scope.
- Validate using the owning TypeBox schema. Missing files may initialize defaults; malformed or
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

Features own ordinary reads and loading/error state; `client/lib/api.ts` supplies Hono RPC. Set
freshness and refresh behavior deliberately if using route loaders. Keep ordinary reads separate
from live snapshots.

Send commands through explicit feature actions. Track pending/error feedback in client state. After
configuration changes, refresh affected reads while preserving drafts. Preserve drafts through
recoverable failures. Runtime state confirms execution completion.

Start with framework-native state for reads and command feedback. Adopt an established query library
when shared refreshed data, pagination, or repeated mutation/cache coordination creates concrete
complexity.

### Branching and tree navigation

Include forking from conversation history and tree-based navigation under the
[domain branching rules](DOMAIN.md#conversation-branches). Show history and branch relationships and
the selected point or branch. Users can revisit the original continuation and continue a fork.
Side-by-side branch comparison is post-MVP; the detailed tree interaction design remains open.

Use supported Durable fork and history APIs through `server/runtime/`. Keep forked history and
lineage durable, and restore the selected view through URL navigation state on reload. Navigation
does not cancel running work; submission and Stop target the conversation explicitly selected for
those actions.

### Submission

1. The client creates a request ID for one logical submission.
2. The server validates input and applies feature policy.
3. The runtime durably admits the submission before HTTP success.
4. The client observes committed progress through AG-UI over HTTP/SSE.

Retain the ID across ambiguous HTTP failures; define its scope and reject reuse with different
content. Newly composed input gets a new ID. Do not indiscriminately retry non-idempotent actions.
[Explicit follow-ups](DOMAIN.md#work-lifecycle) use Durable's inbox, which owns the queue and
placement after the active run during normal execution. Show queued input separately from active
execution. Stop follows the selected runtime's queued-input behavior; see
[recovery and cancellation](#recovery-and-cancellation).

### Streaming

Use AG-UI over HTTP/SSE for frontend conversation synchronization. Translate application-owned
results from Durable's committed-state watches into the protocol at the server transport boundary;
do not expose Chord operations directly to the browser.

Initialize a subscription with `MESSAGES_SNAPSHOT` for the transcript and `STATE_SNAPSHOT` for
application-owned live state. Carry subsequent committed changes through AG-UI message, tool,
lifecycle, and state-update events. Preserve the distinction between durable acceptance, eventual
execution outcome, and transport failure in the mapping.

One feature subscription owns the viewed conversation's protocol-driven live state and connection
state and shares them with child components. Ordinary reads and command responses update their own
state; the subscription exclusively updates live conversation state.

Bound pending output per connection. For slow readers, resynchronize with fresh snapshots rather
than dropping incremental updates required to reconstruct current state. Dispose server watches on
disconnect and client subscriptions on conversation change or unmount; this ends observation, not
execution. Reconnect starts a fresh stream generation from current committed snapshots, without
requiring replay of every missed event. Accept callbacks exclusively from that generation and show
stale/disconnected state until fresh snapshots arrive.

### Conversation activity

Use conversation-list indicators for running, waiting, and blocked activity; MVP has no separate
work-view screen. Derive activity from committed task graphs, inspection results, and submission
records. Conversation details show task ownership, queued submissions, and reasons for blocked or
interrupted work, including interrupted calls and committed partial output.

Use the runtime's inspection and history directly for MVP observability. Broader capability and
effective-configuration inspection is future direction. Apply observation permissions and exclude
credentials and sensitive configuration; execution requires its own authority. A future
agent-callable inspection tool should share the conversation inspection service.

Use Pino-based structured local logging alongside runtime-backed inspection, following the
[logging ownership and privacy rules](ARCHITECTURE.md#failure-presentation-and-inspection).
OpenTelemetry, Langfuse, and other external observability platforms are outside MVP scope.

### Frontend integration

Follow the selected [frontend direction](ARCHITECTURE.md#frontend-design): Solid 2 with
`@tanstack/ai-client` through a small local binding and locally owned rendering. AG-UI remains the
conversation protocol.

Accessibility work requires a separate scope decision.

`client/styles/theme.css` owns semantic CSS variables and Tailwind mappings: `@theme` produces
utilities; `@theme inline` references variables. Light and dark themes share token names. Persist
explicit overrides in application preferences.

`client/ui/` owns domain-free primitives and finite typed size/emphasis variants. Features own
terminology, state, and compositions; promote only shared domain-free compositions. Keep imports
explicit. Add providers, styling engines, and wrappers for concrete needs. Keep primitives in this
package, use feature-owned state initially, and integrate capabilities directly.

Follow [DESIGN.md](DESIGN.md) for presentation and [AGENTS.md](AGENTS.md#ui-primitives) for
component conventions. Import Lucide directly through a frontend-compatible integration. Validate
patterns in feature screens. Add a gallery/Storybook when feature examples need dedicated tooling.

## Recovery and cancellation

Implement the [domain lifecycle](DOMAIN.md#work-lifecycle) through Durable. Disconnect or an aborted
HTTP wait disposes observation while execution continues. Graceful server shutdown closes observers
and runtime resources; user Stop follows its own cancellation contract.

Stop terminates the active run and its owned processes, and waits for confirmation that they have
stopped. Queued-input behavior follows the selected runtime; queue preservation, explicit
resumption, and a persisted queue-pause state are not MVP requirements.

At startup, discover unfinished sessions and automatically resume eligible work once definitions and
execution environments are ready, independently of browser connections. An option to disable
recovery remains an operational decision. Preserve upstream tool replay policies; require evidence
for replay-safe declarations. Interrupted unsafe calls produce `interrupted` results with committed
partial output rather than automatically rerunning the call. Show these in the conversation and
instruct the agent to inspect actual state before retrying uncertain effects. The agent may issue a
new equivalent command, so this is not an exactly-once guarantee. Show actionable diagnostics for
genuinely blocked execution; do not add a dedicated recovery dashboard or blanket human-approval
workflow.

## Open decisions

Resolve the OpenAI login setup flow, credential storage and account-configuration layout, data
location, backup procedure, SQLite synchronization, and request/output limits before their
corresponding capabilities enter use. Document chosen limits; escalate only when evidence requires a
product tradeoff or architecture change.

Resolve the mapping of branch trees to Durable conversations and history, valid fork points, and
forking behavior while source work is running during runtime integration. The tree interaction
design and frontend integration details remain open within the agreed branching scope.

## Acceptance checks

### Integration checks

These criteria define verification for their corresponding capabilities when in scope. Track
completion through actual check results. Use an exact runtime version, fake providers, harmless
tools, and isolated temporary state.

- **Runtime:** submit, watch, retry, Stop, close/reopen, and abrupt-exit recovery. Verify session
  isolation, single database ownership, chosen synchronization policy, closed-harness backup and
  restore, and representative database/WAL growth, memory, and reopen time. Process-exit tests cover
  process crashes; power-loss durability requires separate evidence.
- **Models and credentials:** complete a Durable response through `pi-ai` with a fake provider.
  Verify the OpenAI login integration with fake authentication, model availability, and simultaneous
  conversations bound to different accounts. Account credentials and refresh state stay isolated;
  configuration changes preserve admitted work's account binding. Concurrent refresh reuses fresh
  credentials for the same account; cancellation preserves rotated tokens. Authentication and
  credential-persistence failures produce actionable diagnostics.
- **Branching:** fork from a historical point, preserve the original continuation, and continue the
  fork independently. Verify history and lineage survive close/reopen and server restart, new
  branches use the selected account rather than a historical account binding, and tree navigation
  identifies the selected point or branch. Reload restores the selected view. Switching views does
  not cancel running work, and submission and Stop target the explicitly selected conversation.
- **Transport:** TypeBox-validated JSON through Hono RPC to the client, valid/invalid inputs, error
  narrowing, and browser bundle boundaries. Validate AG-UI events and their application-owned state
  payloads. Verify committed-state mapping to initial snapshots and incremental updates, reconnect
  convergence from fresh snapshots, and branch switching while other work continues. A lost
  submission response followed by retry creates one input. Check confirmed cancellation, bounded
  slow-reader output with snapshot resynchronization, observer cleanup, and stale callback/late
  response rejection. Reads and commands preserve drafts and protocol-driven live state.
- **Security and UI:** reject hostile hosts/origins, traversal, mismatched request IDs, and
  oversized input. Verify safe Markdown, error/disconnection feedback, primitive variants, control
  interactions, dismissal, and long content in both themes and narrow/wide feature screens.
- **Application state:** for each file, verify initialization, round trips, invalid-file
  preservation, newer-version rejection, concurrent updates, failed-save isolation, and
  missing-project errors. Test historical migrations when historical schemas exist.
- **Configuration and lifecycle:** stable context during concurrent submissions/configuration
  changes, and idle guards for runtime-limited changes. Stop terminates owned processes and waits
  for confirmed termination of the cancelled run and its processes. Queued-input behavior through
  Stop, reconnect, and restart matches the selected runtime without duplicate input. Startup
  recovery runs independently of browser connections for eligible work. Verify upstream tool replay
  policies: unsafe interrupted calls do not rerun automatically, their committed partial output is
  visible, and the model can continue without blanket human approval. Verify recovery instructions
  direct the agent to inspect actual state before retrying uncertain effects. Outcomes stay
  independent of connection state; tool failures may leave runs active. Verify safe failure/blocked
  summaries, follow-ups through the runtime inbox, conversation-list running/waiting/blocked
  indicators, and task ownership, queued input, and blocked/interrupted reasons in conversation
  details. Disconnected state shows the last observation; a fresh observation confirms current
  state. File edits and shell commands execute directly under the MVP's unsandboxed host policy.

### Test isolation and browser coverage

Use Node's test runner for server/contracts where sufficient, Playwright for E2E, and separate
component tooling when focused interaction checks require it. Live model calls require explicitly
invoked manual smoke checks.

Tests use synthetic state and fake provider credentials exclusively. Give each test its own writable
runtime directory and clean up processes and temporary data.

As runtime integration is added, browser journeys in `tests/e2e/`, configured by
`playwright.config.ts`, exercise the real frontend, workspace routes, AG-UI stream, and runtime with
a deterministic fake model and isolated JSON/SQLite state. Use Playwright's local-server support and
verify readiness of the test instance. Connect exclusively to that test instance. Use separate
ports/storage for concurrent instances or serialize the suite until isolation exists.

Cover directory/project and account selection, conversation navigation and activity indicators, fork
creation, tree navigation between original and forked histories, continuation on the selected
branch, submit-to-stream-to-Stop, the selected runtime's queued-input behavior, reload/reconnect
preserving committed state and the selected branch view, and core controls. Use role/label locators
to assert visible outcomes, and synchronize checks through retrying assertions. Keep abrupt-exit,
malformed persistence, and detailed failure injection in Node integration tests; browser journeys
focus on cross-system behavior.

Keep workspace operations in its `Justfile` and use
[system Chromium](DECISIONS.md#adr-001-use-system-chromium-for-e2e). [README.md](README.md) owns
commands and browser configuration. Preserve root workspace registration, formatter/lint scopes, and
browser-specific lint environments. Keep repository orchestration in `Justfile`.