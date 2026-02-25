## Engineering Principles
- Load this file only for code edits, code reviews, and design/architecture decisions.

## Execution Rules (When Editing Is Explicitly Requested)
- Pre-edit failure-mode preflight: check technical failure (logic/edge cases), communication failure (scope/intent mismatch), and operational failure (not actionable/verifiable) before editing.
- Prefer the best boundary for data/logic over the smallest change.
- Fix root cause; no band-aids.
- Write the minimum code that solves the problem; no speculative features, flexibility, or config.
- During explicitly requested edits, allow proactive simplification only when behavior stays unchanged and complexity drops.
- Treat backward compatibility vs migration as a product decision; surface tradeoffs and get explicit direction.
- Do not improve adjacent code/comments/formatting unless required by the change or agreed simplification.
- Every changed line should trace to the user request, agreed simplification, or proactive removal of irrelevant/obsolete code.
- Use latest stable libs/docs; if unsure, do a web search. Prefer the most recent stable official docs/sources available at execution time unless an older version is explicitly needed.

## Design Principles
- Optimize for low complexity over time; complexity = dependencies + obscurity.
- Optimize for long-term sustainability: maintainable, reliable designs.
- Keep a single source of truth for business rules/policy (validation, enums, flags, constants, config) and a single canonical implementation per behavior.
- Prefer explicit data flow (args/returns) over implicit flow (globals, singletons, shared mutable state).
- Keep definitions near use; avoid unnecessary cross-file jumping.
- Prefer composition over inheritance.
- Preserve substitutability: derived types preserve base observable properties.
- Prefer deterministic, repeatable, auditable solutions.
- Follow "parse, don't validate": parse into concrete structures, then validate.

### Always-Run Post-Change Checks
- Change amplification: if a small change touched many places, centralize the decision and remove leakage.
- Unknown unknowns: if a new reader would not know where else to look, improve module boundaries or add a guiding comment.
- Cognitive load: reduce concepts in working memory via deeper modules, clearer names, or moving detail downward.

### Modules and Interfaces
- Prefer deep modules: small/simple interface, substantial hidden complexity.
- Pull complexity downward: make callers simpler even if callees become harder.
- No pass-through layers: forwarding wrappers with mirrored signatures are a smell; delete, merge, or change the abstraction.
- Adjacent layers must expose different abstractions; avoid the same API at two layers.
- Make interfaces somewhat general-purpose when it simplifies the API; do not generalize for hypothetical features.
- Default to concrete dependencies; add interfaces/DI only when multiple implementations run in the same program or swapping is an immediate need.

### Decomposition, APIs, and Errors
- Decompose by responsibility/knowledge, not by time/order.
- If A requires reading B to understand it, restructure (merge, inline, rename, or introduce a deeper module).
- Avoid classitis: many tiny shallow classes usually increase cognitive load.
- The common case should be trivial: one obvious call, minimal config.
- Make misuse hard: encode invariants in types/constructors/module boundaries; minimize "caller must remember X".
- An interface must be explainable in 1-3 sentences; if not, redesign.
- Prefer to define recoverable errors out of existence when reasonable (normalize/default internally).
- Mask recoverable low-level errors inside modules (retry, fallback, internal repair).
- Aggregate errors at boundaries: expose a small stable error surface; avoid leaking internal failure modes unless callers can act on them.

### Naming, Comments, and Refactor Triggers
- Names must create a clear image. Avoid: `data`, `info`, `result`, `handler`, `manager`, `util`.
- Functions/methods must express intent, not implementation.
- Comments are for why/intent/rationale, invariants/units/boundaries, and non-obvious tradeoffs.
- For new modules/APIs, write interface comments first; if hard to write, redesign before coding.
- Avoid comments that merely restate code.
- Refactor triggers to evaluate (not automatic):
  - A small change touched 3+ files.
  - A new flag/option must be threaded through callers.
  - Logic is duplicated "just this once."
  - A helper/wrapper mostly forwards calls.
  - You cannot name something without vague words.

## Tooling
- Android: Java > Kotlin.
- Frontend: component-first; reusable, composable UI.
- Shell: run `shellcheck` on shell changes.
- TS AST transforms: prefer `ts-morph`; avoid string transforms unless necessary.
- Public APIs: use structured doc comments (JSDoc/TSDoc). Inline comments only for local invariants or non-obvious logic.
- Testing: prefer real implementations when feasible; avoid mocks by default.
- Compatibility: for public/external APIs/ABIs, avoid breaking users; for internal code, change freely and let compiler/tests enumerate fallout.
- Do not add defensive guards when invariants guarantee correctness unless asked or evidenced.
- Keep shell commands deterministic and non-interactive; limit output (for example `head`) and pick a single result consistently.

## Type Style (Hard Rules)
- Prefer explicit, named types over inferred/meta utility types.
- Avoid type-level indirection that reduces readability (for example utility extraction, indexed access).
- Import domain types directly; define local aliases when clarity improves.
- Do not silence type/lint errors via casts; fix the source type.
- Exceptions (one-line justification required):
  - Generic/helper libraries where inference is the goal.
  - Framework callbacks where explicit types would duplicate unstable signatures.