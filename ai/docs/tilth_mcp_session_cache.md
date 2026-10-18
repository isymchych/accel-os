# Tilth MCP Cache, Pi Session Trees, and Codemode

## Status and scope

Draft migration guidance, not an approved runtime migration. This document replaces the
adapter-specific reconnect proposal with a native Pi MCP assessment. It separates transport
integration from output-cache correctness.

The repository currently uses `ai/pi/extensions/tilth-cli/` for `ai tilth`: every tool call launches
a one-shot Tilth process with an explicit working directory. The launcher defaults to Srcwalk and
explicitly loads Pi's built-in MCP, codemode, and tool-search extensions. `ai/pi/mcp.json` does not
configure Tilth.

Evidence baseline: installed Pi 1.0.4 and Tilth 0.10.1. Recheck provider contracts when changing
versions. Editing this guidance does not authorize changes to the launcher, extensions, or MCP
configuration.

## State ownership problem

Tilth MCP owns a process-local `Session.expanded` map. Entries identify a source path and line and
record the file mtime. Search and grok can suppress previously expanded definitions with
`[shown earlier]`. Mtime invalidation addresses source changes, not whether output remains available
to the model.

Two different assumptions can fail:

```text
Server remembers an expansion != active model context contains it
Server returned an expansion  != model received it
```

### Conversation trees and compaction

1. Branch A expands a definition and Tilth records it.
2. `/tree` moves to a leaf whose model context does not include that result.
3. The persistent server still remembers the expansion.
4. A later search can suppress the body as already shown.

Compaction can similarly remove an earlier result. A summary mentioning a symbol is not equivalent
to retaining its source. Returning to a branch may safely show the body again; exact branch-local
deduplication is not required.

### Codemode filtering

Pi codemode receives complete MCP results and only sends the script's output to the model. A script
can discard an expanded definition while the server records that expansion. A subsequent call can
then suppress source that the model never received, even in a linear conversation.

This is an inferred failure mode from the two implementations, not a completed live reproduction.
Parallel calls and host-side result truncation also belong in verification: expansion ownership must
not depend on output reaching the model intact.

Pi's codemode `store()` is persisted along each session branch. That does not make an external
server's memory branch-aware or acknowledge which source reached the model. Do not move expansion
tracking into the store without a defined visibility and compaction contract.

## Recommended direction

Retain the one-shot CLI transport until a persistent MCP integration meets the correctness checks
below. The existing tools already support namespaced codemode discovery; native MCP is a transport
and maintenance simplification, not a prerequisite for codemode.

The preferred future design is native Pi MCP with persistent parsing/index caches but no cross-call
output deduplication:

```text
ai tilth -> native Pi MCP -> persistent Tilth server
                              |-- reusable source caches
                              `-- no assumption that prior output is visible
```

A Tilth mode that disables cross-call expansion suppression is a proposed upstream capability, not a
verified available option. Fix this assumption at its owning boundary rather than introducing branch
snapshots or lifecycle resets merely to preserve the optimization.

One-shot execution trades repeated parsing for deterministic per-call expansion state, explicit
`ctx.cwd`, bounded output, and process-scoped timeout cleanup. Revisit it when measured
parsing/startup cost or adapter maintenance becomes material, or when Tilth provides a supported
mode that passes the migration checks. Native MCP availability alone is not sufficient evidence to
switch.

## Native Pi MCP contracts

Pi 1.0.4 provides the following public surfaces:

- `mcp.json` configures stdio servers with `command`, `args`, `cwd`, and `env`; relative `cwd`
  resolves against the session directory.
- `exposure: "codemode"` is the default. Scripts discover tools through `searchTools()`,
  `describeTool()`, and `describeNamespace("mcp__tilth")`; namespace descriptions include server
  instructions. `direct`, `deferred`, and per-tool exposure overrides are also supported.
- Tools are named `mcp__<server>__<tool>`, not the CLI extension's `tilth_*` names. MCP instructions
  are not automatically part of individual tool descriptions.
- MCP calls from codemode pass through Pi's tool pipeline and resolve to complete `CallToolResult`
  objects, including `content`, `structuredContent`, and `isError`. Scripts must preserve relevant
  errors when reducing results.
- `/mcp reconnect tilth` is a public connection-management command.
- `pi.registerMcpServer()` and `pi.unregisterMcpServer()` manage extension-owned registrations.
  Re-registering replaces the registration; a file-configured server of the same name takes
  precedence.
- Registering `/mcp` in an extension, as `pi-mcp-adapter` does, replaces native session MCP support.
  Use one MCP owner, not both.

The inspected public extension API does not offer a dedicated awaitable reconnect operation.
Registration replacement triggers asynchronous connection changes; it is not a verified reset
barrier before the next tool call. Codemode discovery surviving `/tree` does not imply that
server-owned caches reset.

Native MCP should own transport, connection cleanup, discovery, and tool registration. Any retained
Tilth-specific extension should own only behavior that configuration and server instructions cannot
supply. Avoid copying schemas or wrapping every MCP tool solely to retain the existing CLI names.

## Other migration constraints

### Repository targeting

Tilth 0.10.1 search/list/grok scope resolution defaults to the server working directory when `scope`
is omitted, even if `root` is supplied. An explicit relative scope requires an absolute root; an
absolute scope selects the directory directly. Native MCP does not change these server rules.

A migration must preserve correct targeting for the active repository, subdirectories, and other
checkouts. Use explicit absolute directory scopes where appropriate; verify read/deps/diff against
their own schemas instead of treating every `scope` as a directory. The CLI adapter's diff scope is
a repository-relative changed file or `file:function` filter.

### Timeouts and cancellation

Tilth's MCP implementation tracks workers that can continue after a tool timeout. Native client
cancellation is not proof that a server worker stopped. Verify subsequent calls and shared-state
behavior after both cancellation and timeout before claiming equivalence with one-shot process
cleanup.

### Configuration and rollout

If a native MCP migration is separately approved:

1. Select one canonical Tilth transport. Remove the CLI extension from `ai tilth` when native MCP
   becomes its transport; do not expose two competing Tilth workflows by default.
2. Keep the server name `tilth`. Prefer the repo-local public `tilth` binary and reproducible
   PATH/cwd settings; avoid `npx` and internal package executable paths.
3. Scope enablement to the selected backend so default Srcwalk sessions do not unintentionally start
   Tilth. Extension-owned registration is an option for this selection; account for file-configured
   overrides.
4. Use native exposure settings instead of adapter-only `directTools`, `toolPrefix`, lifecycle, or
   resource settings. Ensure codemode or tool search can reach the selected tools and preserve the
   intended read-only tool surface.
5. Keep the namespace workflow discoverable. Update launcher help, routing guidance, and tests for
   actual MCP tool names and behavior; retire CLI-only hints, wrappers, and tests made obsolete by
   the migration.
6. Verify shutdown and reload cleanup before adding startup resets. Restore the CLI selection and
   remove the native registration/configuration if rollout fails.

Do not keep two registrations of the same tool names or rely on registration order to select
behavior.

## Reconnection as a limited mitigation

The earlier proposal used `pi-mcp-adapter` and command-dispatched reconnection after tree
navigation. Native Pi also supports `/mcp reconnect tilth`, but reconnect-on-tree remains a partial
mitigation: it discards useful source caches, does not address codemode filtering, and may run too
late for automatic compaction recovery.

If lifecycle reconnection is separately selected as an interim design, preserve these requirements:

- Listen to successful `session_tree`, not `session_before_tree`; cancelled navigation and equal
  old/new leaf IDs require no reconnect.
- Defer command dispatch until navigation returns, coalesce repeated requests, and cancel scheduled
  callbacks on shutdown/reload.
- Use the public `/mcp reconnect tilth` boundary. Verify `pi.sendUserMessage()` with command
  expansion enabled executes it without leaving a normal user message or starting an unintended
  model turn. Do not assume the old sketch is production-ready for native MCP.
- Reset only Tilth, leave other servers connected, and verify the reset completes before the next
  affected Tilth call.
- Successful manual/idle compaction may use the same mechanism only when proven safe. Failed
  compaction requires no reset.
- Threshold and overflow-recovery compaction can occur during an active agent run. Queued
  `steer`/`followUp` commands or a reset at `agent_settled` do not establish correctness for the
  immediate retry. Claim that coverage only after verifying ordering before its next Tilth call.
- Let the MCP owner clean up connections on session replacement and `/reload`. Verify `/new`,
  `/resume`, `/fork`, and `/clone`; add startup resets only if a stale process actually survives
  replacement.
- Add high-level TSDoc to any lifecycle extension explaining the state-ownership mismatch and its
  explicitly limited coverage.

Prefer a supported awaitable lifecycle API if synchronous reset becomes necessary. Command injection
is acceptable only while its ordering and transcript behavior are proven and its uncovered cases are
explicit.

## Alternatives not selected

- **Idle timeouts or manual reconnect:** eventual or user-dependent; neither enforces context
  visibility.
- **PID discovery, process killing, or restarting all servers:** bypasses the MCP owner's lifecycle
  and can affect unrelated servers.
- **A separate reset process:** cannot reset the adapter/native connection's process-local state.
  Tilth 0.10.1 dispatches `tilth_session` internally but does not advertise it in `tools/list`; Pi
  discovery cannot be assumed to expose it.
- **Git watchers:** source invalidation is already based on mtime. HEAD/index changes do not
  establish that model context lost an expansion.
- **Per-leaf snapshot/restore:** Tilth has no verified public expansion-state export/import
  contract. It also does not solve codemode filtering or compaction by itself. Reconsider only if
  preserving deduplication has measurable value and visibility ownership is defined.
- **Private adapter/native-module patches:** use public lifecycle boundaries. Prefer a narrow
  upstream output-dedup control over a new transport wrapper.

## Verification before migration

These checks are acceptance criteria, not reported test results. Run a live check through the chosen
native integration, including codemode, rather than testing only mocked lifecycle events.

| Scenario                      | Required observation                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tree navigation               | Expand a large definition, navigate before/outside its result, and request it again: its body is available. Returning to the original branch may show it again. |
| Cancelled/no-op navigation    | No unnecessary reset or connection disruption.                                                                                                                  |
| Codemode filtering            | Discard an expanded body from a script's output, then request it in a later script: the body remains available.                                                 |
| Parallel calls and truncation | Overlapping queries and bounded host/script output do not make later source retrieval depend on unseen output.                                                  |
| Compaction                    | Test manual, threshold, and overflow recovery separately; needed source is available on the first post-compaction call, including automatic retry.              |
| Repository selection          | Give two checkouts distinguishable source; search/list/grok/read/deps/diff inspect the requested checkout and honor each tool's scope semantics.                |
| Timeout/cancellation          | Interrupt an expensive call; later calls return correct results without stale-worker cache contamination or accumulating abandoned work.                        |
| Replacement/reload            | `/new`, `/resume`, `/fork`, `/clone`, and `/reload` do not inherit inaccessible expansion history or leave duplicate server processes.                          |
| Exposure and errors           | Namespace instructions and tool schemas are discoverable; MCP errors remain visible through codemode; only intended read-only tools are reachable.              |
| Isolation                     | Other MCP servers remain connected; default Srcwalk sessions retain their selected workflow.                                                                    |

For a lifecycle mitigation, additionally test different/equal leaf IDs, coalescing, callback
cancellation, exact reconnect command and expansion option, command invisibility, and completion
before the next Tilth call. Measure reconnect cost rather than assuming startup is negligible.

## Evidence and open questions

Local implementation evidence:

- `ai/pi/extensions/tilth-cli/index.ts` and `tool.ts`: CLI ownership, routing, budgets, cwd,
  timeout, and diff contracts.
- `ai/pi/runtime/pi-launcher.ts`, `ai/pi/ai.ts`, and `ai/pi/mcp.json`: backend selection and native
  extension loading.
- Installed Pi `docs/mcp.md`, `docs/codemode.md`, and `dist/core/extensions/types.d.ts`: public
  MCP/codemode contracts and extension API.
- Installed Pi `dist/extensions/mcp/index.js`: registration replacement and session shutdown
  handling; implementation evidence, not an API to import.

Version-pinned upstream evidence:

- [Pi 1.0.4 MCP documentation](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/mcp.md)
- [Pi 1.0.4 codemode documentation](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/codemode.md)
- [Tilth 0.10.1 session state](https://github.com/jahala/tilth/blob/v0.10.1/src/session.rs)
- [Tilth 0.10.1 MCP dispatch and worker lifecycle](https://github.com/jahala/tilth/blob/v0.10.1/src/mcp/mod.rs)
- [Tilth 0.10.1 scope resolution](https://github.com/jahala/tilth/blob/v0.10.1/src/mcp/tools/mod.rs)
- [Tilth 0.10.1 advertised tool definitions](https://github.com/jahala/tilth/blob/v0.10.1/src/mcp/tools/definitions.rs)

Open questions are whether a supported Tilth no-dedup mode becomes available, whether repeated CLI
parsing has material cost, and whether native MCP passes the targeting, worker-cleanup, and
context-visibility checks. Until those are resolved, native MCP is the preferred prospective
transport, not a completed or approved replacement.