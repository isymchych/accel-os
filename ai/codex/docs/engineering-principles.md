## Engineering Principles
- You MUST load this file for coding work: code planning before implementation, code edits/implementation, code/design review, debugging/root-cause analysis, and architecture/refactor decisions.
- You SHOULD avoid loading this file for non-coding tasks.

## Normative Terms
- `MUST`: required unless an explicit higher-priority rule overrides it.
- `SHOULD`: expected default; deviations are allowed with a stated reason.
- `MAY`: optional.

## Execution Rules (When Editing Is Explicitly Requested)
- You MUST run a pre-edit failure-mode preflight: technical failure (logic/edge cases), communication failure (scope/intent mismatch), and operational failure (not actionable/verifiable).
- You MUST run a pre-edit "local patch vs structural fix" decision check when any refactor trigger is present.
- The decision check MUST name both options, compare tradeoffs, and state the selected path.
- You SHOULD prefer the best boundary for data/logic over the smallest change.
- You MUST use Root Cause Analysis for coding work that involves debugging, incidents, regressions, or recurring failures.
- You MUST fix the proven root cause rather than patch symptoms.
- If root cause is not yet proven, you MUST implement a bounded mitigation with an explicit root-cause hypothesis and validation plan.
- You MUST write the minimum code that solves the problem; minimum code means minimum necessary complexity, not minimum diff size.
- You SHOULD prefer structural fixes when they reduce recurring complexity, coupling, or cross-file change pressure, even when the diff is larger.
- You MUST NOT choose a minimal diff if it preserves a known poor boundary that materially contributed to the issue.
- You MUST NOT add speculative features, flexibility, or config.
- You MAY do proactive simplification only when behavior is unchanged and complexity drops in the touched area.
- You MUST NOT do adjacent cleanup that is unrelated to the request unless the user explicitly agrees.
- You MUST ensure every changed line maps to one of: user request, agreed simplification, or removal of irrelevant/obsolete code.
- You MUST timebox structural exploration and keep non-goals explicit to avoid gold-plating.
- If simplification expands scope (new modules, migrations, or user-visible behavior risk), you MUST pause and request reconfirmation.
- You MUST treat backward compatibility vs migration as a product decision and get explicit direction when tradeoffs exist.
- You MUST follow repository-pinned versions/lockfiles/toolchains.
- You SHOULD prefer official documentation for the pinned version in use.
- You MAY use web search for clarification when local docs are insufficient and network policy allows it.
- You MUST NOT upgrade dependencies solely to follow "latest stable" unless explicitly requested.

## Design Principles
- You SHOULD optimize for low complexity over time; complexity = dependencies + obscurity.
- You SHOULD optimize for long-term sustainability: maintainable, reliable designs.
- You SHOULD keep a single source of truth for business rules/policy (validation, enums, flags, constants, config).
- You SHOULD keep a single canonical implementation per behavior.
- You MAY keep more than one implementation when required by staged migration, hard isolation boundaries, or measured performance constraints; you MUST document ownership and a convergence/sunset plan.
- You SHOULD prefer explicit data flow (args/returns) over implicit flow (globals, singletons, shared mutable state).
- You SHOULD keep definitions near use and avoid unnecessary cross-file jumping.
- You SHOULD prefer composition over inheritance.
- You SHOULD preserve substitutability: derived types preserve base observable properties.
- You SHOULD prefer deterministic, repeatable, auditable solutions.
- You SHOULD follow "parse, don't validate": parse into concrete structures, then validate.

### Post-Change Checks (Code Edits Only)
- These checks apply only when the task includes code edits.
- You MUST run applicable verification checks and report outcomes in the completion report.
- You MUST include exact commands for each verification item.
- Verification commands MUST prefer repository-defined entrypoints over ad-hoc commands.
- Precedence: documented project targets (AGENTS/README/justfile/Makefile/package scripts) first; raw tool commands only as fallback.
- If fallback commands are used, you MUST state why in the report.
- You MUST NOT report `pass` for checks that were not run; use `not_run` or `not_applicable`.
- You MUST run the standard verification set by default for code edits: targeted tests, typecheck, and applicable formatting/lint checks.
- You SHOULD report results using the "Completion Report Format" below for human-readable, skimmable output.
- Change amplification: if one behavior change touches 3+ files, you SHOULD centralize the decision or explain why centralization is not appropriate.
- Unknown unknowns: for each new or changed entrypoint, you MUST add at least one concrete breadcrumb to the next decision point (for example module boundary, interface comment, or explicit file/symbol reference).
- Cognitive load: if a change introduces new complexity (new concepts, API surface, or call-site branching), you MUST either (a) remove at least one existing load driver in the touched area or (b) state why reduction is unsafe now and record a follow-up.
- If any refactor trigger was present and a local patch was selected, you MUST record why structural change was deferred and what follow-up would retire the debt.

### Completion Report Format (Required for Code-Edit Task Reports)
Use this exact section order:
1. `Summary`
2. `Changes Made`
3. `Check Results`

#### 1) Summary
- `Result: <PASS|FAIL|WARN>`
- `Scope: <areas/files validated>`
- `Risk: <none|low|medium|high> (+ 1 short reason)`
- `Tests: <clean|failed|not_run>`
- `Typecheck: <clean|failed|not_run>`
- `Format/Lint: <clean|failed|not_run>`
- `Format/Lint` MUST align with `tooling_style` outcomes.
- `Confidence` values in `Summary` MUST reflect final check outcomes only; do not include attempt counts.
- `Scope drift: <match|drifted>`
- `Behavioral risk: <none|low|medium|high>`

#### 2) Changes Made (2-5 bullets)
- Start each bullet with a past-tense verb.
- Include only behaviorally relevant edits in requested scope.

#### 3) Check Results (icon-first blocks)
Use one 2-3 line block per check, in this format:

```
<status_icon> <check_name>
- cmd: <exact command or n/a>
- evidence: <1 short concrete line>
- refs: <policy refs only>   # only for doc_code_style, agents_compliance
```

Status icon mapping:
- `✅` = `pass`
- `❌` = `fail`
- `⚠️` = `warn`
- `⚪` = `n/a`
- `⏭️` = `not_run`

Required checks:
- `tests`
- `typecheck`
- `tooling_style`
- `doc_code_style`
- `agents_compliance`

Rules:
- List failed checks first, then warns, then pass, then n/a/not_run.
- Do not mark `pass` unless the command/check was actually run.
- You MUST report final resolved status per check, not per-attempt history.
- If a check is retried and a later run passes, the check MUST be `✅`.
- For `tooling_style`, you MUST run and report applicable lint checks (for example ESLint).
- For `tooling_style`, you SHOULD also run and report applicable formatter checks (for example Prettier).
- `tooling_style` is `pass` only when all applicable lint/format checks were run and clean.
- If lint is applicable but was not run, `tooling_style` MUST be `⚠️` or `⏭️`, not `✅`.
- Keep `evidence` at or under 80 characters when possible.
- Keep `cmd` display at or under 120 characters when possible.
- If `cmd` exceeds display length, truncate with `...`.
- `refs` MUST point to governing rules, not changed files or artifacts.
- For `doc_code_style`, `refs` MUST cite style policy sections/bullets (for example `docs/engineering-principles.md#Code Style`).
- For `agents_compliance`, `refs` MUST cite AGENTS rules/sections (for example `AGENTS.md#Execution Gate`).

Examples:
- Valid: `refs: docs/engineering-principles.md#Code Style; AGENTS.md#Execution Gate`
- Invalid: `refs: plans/foo.md (/abs/path/plans/foo.md)`


### Modules and Interfaces
- You SHOULD prefer deep modules: small/simple interface, substantial hidden complexity.
- You SHOULD pull complexity downward to make callers simpler, even if callees become harder.
- You SHOULD treat pass-through layers as a smell; delete, merge, or change the abstraction when practical.
- Adjacent layers SHOULD expose different abstractions; you SHOULD avoid duplicating the same API at two layers.
- You SHOULD make interfaces somewhat general-purpose when it simplifies the API; you MUST NOT generalize for hypothetical features.
- You SHOULD default to concrete dependencies; you SHOULD add interfaces/DI only when multiple implementations run in the same program or swapping is an immediate need.

### Decomposition, APIs, and Errors
- You SHOULD decompose by responsibility/knowledge, not by time/order.
- If understanding A routinely requires reading B, you SHOULD restructure (merge, inline, rename, or introduce a deeper module).
- You MAY keep the split when it protects a clear boundary (ownership, deployment, security, or performance); you MUST document that boundary.
- You SHOULD prefer pure collection helpers that return values instead of mutating caller-provided accumulators.
- You SHOULD avoid helper signatures that take output arrays/results (for example `docs`, `items`, `result`) unless mutation is required by API constraints, streaming behavior, or measured performance/allocation needs.
- During refactor extraction, if helper behavior is primarily append/push, you SHOULD redesign it to return values and compose at the call site unless a documented exception applies.
- Mutable-sink helpers MUST make side effects explicit via naming/docs (for example `appendTo`/`collectInto`) and SHOULD avoid mixed semantics.
- You SHOULD avoid classitis: many tiny shallow classes usually increase cognitive load.
- The common case SHOULD be trivial: one obvious call, minimal config.
- You SHOULD make misuse hard by encoding invariants in types/constructors/module boundaries.
- An interface SHOULD be explainable in 1-3 sentences; if not, you SHOULD redesign it.
- You SHOULD define recoverable errors out of existence when reasonable (normalize/default internally).
- You SHOULD handle recoverable low-level errors inside modules when safe and observable.
- You MUST preserve observability for handled errors (for example logs/metrics/traces) at the appropriate boundary.
- You MUST surface errors that callers can act on; you SHOULD aggregate internal details behind a stable boundary error model.

### Naming, Comments, and Refactor Triggers
- Names MUST create a clear image. You SHOULD avoid vague names such as `data`, `info`, `result`, `handler`, `manager`, and `util`.
- Functions/methods SHOULD express intent, not implementation.
- Comments SHOULD capture why/intent/rationale, invariants/units/boundaries, and non-obvious tradeoffs.
- For new modules/APIs, you SHOULD write interface comments first; if hard to write, you SHOULD redesign before coding.
- You MUST avoid comments that merely restate code.
- Refactor triggers to evaluate (not automatic):
  - A small change touched 3+ files.
  - A new flag/option must be threaded through callers.
  - Logic is duplicated "just this once."
  - A helper/wrapper mostly forwards calls.
  - You cannot name something without vague words.
  - The same failure pattern has appeared before in adjacent code.

## Tooling
- Android: you SHOULD prefer Java unless project constraints require Kotlin.
- Frontend: you SHOULD use a component-first approach with reusable, composable UI.
- Shell: you MUST run `shellcheck` on shell changes.
- TS AST transforms: you SHOULD prefer `ts-morph`; you SHOULD avoid string transforms unless necessary.
- Public APIs: you SHOULD use structured doc comments (JSDoc/TSDoc). Inline comments SHOULD be limited to local invariants or non-obvious logic.
- Testing: you SHOULD prefer real implementations when feasible; you SHOULD avoid mocks by default.
- Testing: you SHOULD NOT add unit tests for pure delegation methods (methods that only forward args/returns unchanged) when delegated behavior is already covered at the callee level.
- Testing: for behavior-changing edits where automated tests exist (or are added), you SHOULD follow red->green->refactor: write a failing test first, make it pass with the smallest change, then refactor safely.
- Testing: for behavior-changing edits in a module with no automated tests, you MUST stop and ask for explicit direction before implementation.
- Testing: when this gate is triggered, you MUST present options: (a) add a minimal test seam first, (b) proceed with a documented one-time exception and manual verification, or (c) defer the change.
- Testing: non-behavioral edits (for example comments, renames, formatting, or mechanical refactors) MAY proceed without this gate.
- Compatibility: for public/external APIs/ABIs, you MUST avoid breaking users without an explicit migration plan. For internal code, you MAY change freely and use compiler/tests to enumerate fallout.
- You MUST NOT add defensive guards that only mask programmer errors when invariants already guarantee correctness.
- You SHOULD add guards at trust boundaries (I/O, network, parsing, user input) or when invariants have proven unreliable in production/tests.
- You MUST keep shell commands deterministic and non-interactive; you SHOULD limit output (for example `head`) and pick a single result consistently.

## Code Style
- You SHOULD prefer explicit, named types over inferred/meta utility types.
- You SHOULD avoid type-level indirection that reduces readability (for example utility extraction, indexed access).
- You SHOULD import domain types directly; you MAY define local aliases when clarity improves.
- You MUST NOT silence type/lint errors via casts; you MUST fix the source type.
- Exceptions (one-line justification required):
  - Generic/helper libraries where inference is the goal.
  - Framework callbacks where explicit types would duplicate unstable signatures.
