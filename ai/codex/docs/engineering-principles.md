## Engineering Principles
- You MUST load this file for coding work: planning, code edits/implementation, code review, design review, debugging/root-cause analysis, and architecture/refactor decisions.
- You SHOULD avoid loading this file for non-coding tasks.

## Quick Checklist
This checklist is a compressed summary for day-to-day use. The detailed sections below remain canonical.

### Before Editing
- Run a pre-edit failure-mode preflight: technical failure, communication failure, and operational failure. See `Execution Rules`.
- If any refactor trigger is present, run a "local patch vs structural fix" decision check and record the selected path. See `Refactoring Guidance`.
- For debugging, incidents, regressions, or recurring failures, use Root Cause Analysis and fix the proven root cause when possible. See `Execution Rules`.
- Prefer the minimum necessary complexity, not the minimum diff. See `Refactoring Guidance`.
- Stay within requested scope; do not add speculative features, unrelated cleanup, or unrequested compatibility. See `Execution Rules`.

### While Designing and Coding
- Prefer the best boundary for data and logic, especially when it reduces recurring complexity or coupling. See `Refactoring Guidance`, `Design Principles`, and `Modules and Interfaces`.
- Keep a single source of truth and a single canonical implementation per behavior when practical. See `Design Principles`.
- Prefer explicit data flow, deep modules, concrete dependencies, and simple caller experience. See `Design Principles`, `Modules and Interfaces`, and `Decomposition, APIs, and Errors`.
- Make misuse hard at trust boundaries; avoid defensive guards that only mask programmer errors inside trusted code. See `Decomposition, APIs, and Errors` and `Operational Safeguards`.
- Use clear names and comments for non-obvious intent, and refactor when shallow pass-through or repeated change pressure appears. See `Naming and Comments` and `Refactoring Guidance`.

### Before Finalizing
- Run applicable verification and report exact commands and final statuses. See `Verification` and `Completion Reporting`.
- Use repository-defined verification entrypoints before ad-hoc commands. See `Verification`.
- For shell edits, run `shellcheck`. For trust-boundary behavior changes, update tests in the enforcing layer unless an explicit exception was approved. See `Tooling`, `Testing`, and `Operational Safeguards`.
- Do not report checks as `pass` unless they were actually run and passed. See `Verification` and `Completion Reporting`.

## Normative Terms
- `MUST`: required unless an explicit higher-priority rule overrides it.
- `SHOULD`: expected default; deviations are allowed with a stated reason.
- `MAY`: optional.

## Definitions and Judgment Aids
These definitions are guidance for applying the canonical rules below. They clarify intent; they do not replace the detailed sections.

- `Structural fix`: a change that improves the boundary, ownership, or shape of the code so the same class of change or failure becomes less likely to recur. Example: moving duplicated policy logic into one enforcing module instead of patching each call site separately.
- `Local patch`: a narrowly targeted change that fixes the immediate symptom at the current edit point without materially improving the surrounding design. Example: adding a one-off conditional in one caller while the underlying policy remains duplicated elsewhere.
- `Best boundary`: the module, type, or interface edge where a rule or transformation can live once with the least ongoing caller complexity and duplication. Example: normalizing external API data at the parsing boundary instead of forcing every consumer to normalize it independently.
- `Trust boundary`: any boundary where data or control enters a context that cannot safely assume repo-local invariants already hold. Common examples: I/O, network responses, parsing, CLI args, environment variables, user input, storage reads, and cross-process or cross-service messages.
- `Behavior change`: a change that can alter externally observable outcomes, not just implementation shape. Common examples: returned values, thrown errors, fallback behavior, ordering, persistence effects, network calls, logging/metrics visible to operators, rendered UI states, and public or shared contract semantics.
- `Enforcing layer`: the layer that turns a loose input or contract into a relied-on invariant for downstream code. Example: a parser that converts untyped JSON into validated domain objects is an enforcing layer; a pure pass-through wrapper usually is not.
- `Concrete breadcrumb to the next decision point`: a short pointer that helps the next editor find the governing boundary or follow-up location quickly. Examples: an interface comment naming the owning module, a nearby note citing the canonical helper, or an explicit file/symbol reference in the report.

Quick judgment examples:
- If a fix requires threading a new flag through several callers, that is usually a refactor trigger; compare a local patch against moving the decision downward into one module.
- If a change only renames symbols or reshapes internals without affecting outputs or contracts, it is usually not a behavior change.
- If bad input can arrive from outside the current trusted module, add guards at the trust boundary; if the invariant is already guaranteed inside the boundary, prefer fixing the invariant instead of layering defensive checks.

## Review Guidance
- For code review tasks, you SHOULD prioritize bugs, risks, regressions, and missing tests over praise or stylistic commentary.
- You SHOULD order findings by severity when practical.
- You SHOULD present findings before praise, summary, or general commentary.
- You SHOULD include concrete file references where possible.
- If no findings are identified, you SHOULD say so explicitly and note any residual risks, assumptions, or verification gaps when relevant.

## Execution Rules (When Editing Is Explicitly Requested)
- You MUST run a pre-edit failure-mode preflight: technical failure (logic/edge cases), communication failure (scope/intent mismatch), and operational failure (not actionable/verifiable).
- You MUST use Root Cause Analysis for coding work that involves debugging, incidents, regressions, or recurring failures.
- You MUST fix the proven root cause rather than patch symptoms.
- If root cause is not yet proven, you MUST implement a bounded mitigation with an explicit root-cause hypothesis and validation plan.
- You MUST NOT add speculative features, flexibility, or config.
- You MAY do proactive simplification only when behavior is unchanged and complexity drops in the touched area.
- You MUST NOT do adjacent cleanup that is unrelated to the request unless the user explicitly agrees.
- You MUST ensure every changed line maps to one of: user request, agreed simplification, or removal of irrelevant/obsolete code.
- You MUST timebox structural exploration and keep non-goals explicit to avoid gold-plating.
- If simplification expands scope (new modules, migrations, or user-visible behavior risk), you MUST pause and request reconfirmation.
- You MUST treat backward compatibility as opt-in: unless the user explicitly requests compatibility for the current task, you SHOULD prefer the simplest correct change even if it is breaking.
- You MUST follow repository-pinned versions/lockfiles/toolchains.
- You SHOULD prefer official documentation for the pinned version in use.
- You MAY use web search for clarification when local docs are insufficient and network policy allows it.
- You MUST NOT upgrade dependencies solely to follow "latest stable" unless explicitly requested.
- You MUST NOT introduce compiler workarounds (for example suppressions, bypass flags, or compatibility shims) unless the user explicitly requests a workaround for the current task.

## Refactoring Guidance
- You MUST run a pre-edit "local patch vs structural fix" decision check when any refactor trigger is present.
- The decision check MUST name both options, compare tradeoffs, and state the selected path.
- You SHOULD prefer the best boundary for data/logic over the smallest change.
- You MUST write the minimum code that solves the problem; minimum code means minimum necessary complexity, not minimum diff size.
- You SHOULD prefer structural fixes when they reduce recurring complexity, coupling, or cross-file change pressure, even when the diff is larger.
- You MUST NOT choose a minimal diff if it preserves a known poor boundary that materially contributed to the issue.
- Refactor triggers to evaluate (not automatic):
  - A small change touched 3+ files.
  - A new flag/option must be threaded through callers.
  - Logic is duplicated "just this once."
  - A helper/wrapper mostly forwards calls.
  - You cannot name something without vague words.
  - The same failure pattern has appeared before in adjacent code.
- If any refactor trigger was present and a local patch was selected, you MUST record why structural change was deferred and what follow-up would retire the debt.

## Change Quality Checks
- Change amplification: if one behavior change touches 3+ files, you SHOULD centralize the decision or explain why centralization is not appropriate.
- Unknown unknowns: for each new or changed entrypoint, you MUST add at least one concrete breadcrumb to the next decision point (for example module boundary, interface comment, or explicit file/symbol reference).
- Cognitive load: if a change introduces new complexity (new concepts, API surface, or call-site branching), you MUST either (a) remove at least one existing load driver in the touched area or (b) state why reduction is unsafe now and record a follow-up.

## Design Principles
- You SHOULD optimize for low complexity over time; complexity = dependencies + obscurity.
- You SHOULD optimize for simplicity and readability in code, interfaces, and control flow.
- When tradeoffs are acceptable, you SHOULD prefer the simpler, more readable design.
- You SHOULD follow KISS: choose the simplest design that correctly solves the current problem.
- You SHOULD follow YAGNI: do not add abstractions, configuration, extensibility points, or generalization for hypothetical future needs.
- You SHOULD optimize for long-term sustainability: maintainable, reliable designs.
- You SHOULD keep a single source of truth for business rules/policy (validation, enums, flags, constants, config).
- You SHOULD keep a single canonical implementation per behavior.
- You MAY keep more than one implementation when required by staged migration, hard isolation boundaries, or measured performance constraints; you MUST document ownership and a convergence/sunset plan.
- You SHOULD treat data design as primary: choose domain types and data structures so valid operations are obvious and invalid states are hard to represent.
- You SHOULD prefer simple algorithms and straightforward control flow when the data model can carry the meaning directly.
- You SHOULD encode meaning, invariants, and policy in types, data structures, and module boundaries so callers stay simple.
- You SHOULD prefer explicit data flow (args/returns) over implicit flow (globals, singletons, shared mutable state).
- You SHOULD keep definitions near use and avoid unnecessary cross-file jumping.
- You SHOULD prefer composition over inheritance.
- You SHOULD preserve substitutability: derived types preserve base observable properties.
- You SHOULD prefer deterministic, repeatable, auditable solutions.
- You SHOULD follow "parse, don't validate": parse into concrete structures, then validate.

## Modules and Interfaces
- You SHOULD prefer deep modules: small/simple interface, substantial hidden complexity.
- You SHOULD pull complexity downward to make callers simpler, even if callees become harder.
- You SHOULD treat pass-through layers as a smell; delete, merge, or change the abstraction when practical.
- Adjacent layers SHOULD expose different abstractions; you SHOULD avoid duplicating the same API at two layers.
- You SHOULD make interfaces somewhat general-purpose when it simplifies the API; you MUST NOT generalize for hypothetical features.
- You SHOULD default to concrete dependencies; you SHOULD add interfaces/DI only when multiple implementations run in the same program or swapping is an immediate need.

## Decomposition, APIs, and Errors
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

## Naming and Comments
- Names MUST create a clear image. You SHOULD avoid vague names such as `data`, `info`, `result`, `handler`, `manager`, and `util`.
- Names SHOULD be concise as long as clarity is preserved. You SHOULD prefer the shortest name that still communicates intent.
- Functions/methods SHOULD express intent, not implementation.
- Comments SHOULD capture why/intent/rationale, invariants/units/boundaries, and non-obvious tradeoffs.
- Comments SHOULD be added only when necessary to clarify non-obvious intent, invariants, or behavior.
- For new modules/APIs, you SHOULD write interface comments first; if hard to write, you SHOULD redesign before coding.
- You MUST avoid comments that merely restate code.

## Testing
- You SHOULD prefer real implementations when feasible; you SHOULD avoid mocks by default.
- You SHOULD NOT add unit tests for pure delegation methods (methods that only forward args/returns unchanged) when delegated behavior is already covered at the callee level.
- If you add or change a reusable trust boundary (a shared method/module whose output enforces or interprets contracts), you MUST add or update tests in the enforcing layer in the same patch, or get an explicit user-approved exception in the task thread; triggers include behavior branching (null/throw, fallback/default, policy branch), cross-layer data-shape conversion, fan-out to multiple consumers, and contract bug fixes (add a regression test where the contract is enforced); pure pass-through/delegation changes are exempt unless contract semantics changed.
- For behavior-changing edits in a module with no automated tests, you SHOULD NOT add new tests unless explicitly requested.
- In this case, you SHOULD proceed without stopping to ask and MUST document manual verification and any test gap in the final report.
- Non-behavioral edits (for example comments, renames, formatting, or mechanical refactors) MAY proceed without this gate.

## Operational Safeguards
- Compatibility: you MUST assume compatibility is not required unless the user explicitly requests it for the current task. If compatibility is requested for public/external APIs/ABIs, you MUST avoid breaking users without an explicit migration plan. For internal code, you MAY change freely and use compiler/tests to enumerate fallout.
- You MUST NOT add defensive guards that only mask programmer errors when invariants already guarantee correctness.
- You SHOULD add guards at trust boundaries (I/O, network, parsing, user input) or when invariants have proven unreliable in production/tests.
- You MUST keep shell commands deterministic and non-interactive; you SHOULD limit output (for example `head`) and pick a single result consistently.

## Verification
- These checks apply only when the task includes code edits.
- You MUST run applicable verification checks and report outcomes in the completion report.
- You MUST include exact commands for each verification item.
- Verification commands MUST prefer repository-defined entrypoints over ad-hoc commands.
- Precedence: documented project targets (AGENTS/README/justfile/Makefile/package scripts) first; raw tool commands only as fallback.
- If fallback commands are used, you MUST state why in the report.
- You MUST NOT report `pass` for checks that were not run; use `not_run` or `not_applicable`.
- You MUST run the standard verification set by default for code edits: targeted tests, typecheck, and applicable formatting/lint checks.

## Completion Reporting
### Report Shape
- Use `Summary` only for multi-file, risky, user-visible, or behavior-changing work; for small, low-risk edits, you MAY omit it.
- When present, `Summary` SHOULD briefly cover result, scope, risk, and validation state.
- Include `Changes Made` and `Verification`.
- `Changes Made` SHOULD stay scoped to behaviorally relevant edits in the requested scope.

### Verification Item Rules
- Report one short item per check; keep the final resolved status only.
- `status` MUST be one of: `pass`, `fail`, `warn`, `not_run`, `not_applicable`.
- You MUST NOT mark `pass` unless the command/check was actually run and passed.
- Each runnable check MUST include `cmd` and SHOULD include `evidence`.
- Default required checks are `tests`, `typecheck`, and `tooling_style`.
- Conditional checks are `doc_code_style` and `agents_compliance`; you MAY omit checks that are genuinely out of scope.
- `tooling_style` is `pass` only when all applicable lint and formatter checks that were run are clean; if applicable lint was not run, `tooling_style` MUST be `warn` or `not_run`.
- `refs` MUST point to governing rules, not changed files or artifacts.
- For `doc_code_style`, `refs` MUST include `docs/engineering-principles.md#Code Style`; if that ref is missing, `doc_code_style` MUST be `fail`.
- For `agents_compliance`, `refs` MUST cite AGENTS rules/sections.

## Tooling
- Android: you SHOULD prefer Java unless project constraints require Kotlin.
- Frontend: you SHOULD use a component-first approach with reusable, composable UI.
- Frontend: you SHOULD put meaningful state in the URL.
- Frontend (design tasks): when working inside an existing website or design system, you MUST preserve established patterns and visual language.
- Shell: you MUST run `shellcheck` on shell changes.
- TS AST transforms: you SHOULD prefer `ts-morph`; you SHOULD avoid string transforms unless necessary.

## Code Style
- You SHOULD prefer explicit, named types over inferred/meta utility types.
- You MUST avoid type-level indirection that reduces readability, especially utility type extraction and index types. Reducing coupling is not, by itself, a sufficient reason to introduce index types.
- You SHOULD import domain types directly; you MAY define local aliases when clarity improves.
- You SHOULD avoid creating callback-based APIs, prefer explicit operations
- Public APIs: you SHOULD use structured doc comments (JSDoc/TSDoc).
- You MUST NOT silence type/lint errors via casts; you MUST fix the source type.
- Exceptions (one-line justification required):
  - Generic/helper libraries where inference is the goal.
  - Framework callbacks where explicit types would duplicate unstable signatures.