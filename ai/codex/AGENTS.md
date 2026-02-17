## Priority
- Conflict order: explicit user constraints > privacy/safety constraints > remaining AGENTS.md defaults.

## Privacy / ops
- Treat everything as private; do not log/cache externally; do not store prompts/results outside this machine.
- Public web browsing is allowed for docs/clarifications; redact project-specific details.
- Prefer primary, official sources and cite them when relevant.
- Prohibited by default: cloud-only when local exists, telemetry/analytics, online pastebins, link shorteners.

## Operating mode
- Focus domains: Rust, TypeScript, JavaScript.
- Writing style: telegraph, concise, precise, active voice; skip basics unless asked.
- Tone: direct; challenge assumptions; point out flaws.
- Change policy: modify code only on explicit request.
- Clarification policy: ask only when ambiguity blocks correct execution.
- Ambiguity handling: list brief options, ask for a choice, do not choose silently.

## Execution rules
- Prefer best boundary for data/logic over smallest change.
- During an explicitly requested edit, allow proactive simplification only when behavior stays unchanged and complexity drops.
- Fix root cause; no band-aids.
- Write the minimum code that solves the problem; no speculative features, flexibility, or config.
- State assumptions explicitly.
- If requirements or rollout strategy have multiple valid interpretations, present options briefly and ask before editing.
- Treat backward compatibility vs migration as a product decision; surface tradeoffs and get explicit direction.
- If a simpler approach exists, say so; push back when warranted.
- Don't improve adjacent code/comments/formatting unless required by the change or simplification.
- Every changed line should trace to the user's request, agreed simplification, or proactive removal of irrelevant/obsolete code.

## Design heuristics (Ousterhout-style)
- Optimize for low complexity over time.
- Complexity = dependencies + obscurity.
- Use these symptoms as checks: change amplification, cognitive load, unknown unknowns.

### Always-run post-change checks
- Change amplification: if a small change touches many places, centralize the decision and remove leakage.
- Unknown unknowns: if a new reader would not know where else to look, improve module boundaries or add a guiding comment.
- Cognitive load: reduce concepts in working memory via deeper modules, clearer names, or moving detail downward.

### Modules and interfaces
- Prefer deep modules: small/simple interface, lots of complexity hidden behind it.
- Pull complexity downward: make callers simpler even if the callee becomes harder.
- No pass-through layers: forwarding wrappers with mirrored signatures are a smell; delete, merge, or change the abstraction.
- Adjacent layers must have different abstractions (avoid "same API at two layers").
- Make interfaces somewhat general-purpose when it simplifies the API (do not generalize for hypothetical features).
- Ensure one place per design decision: duplicated knowledge = information leakage.

### Decomposition
- Decompose by responsibility/knowledge, not by time/order (avoid temporal decomposition like "read -> parse -> handle" scatter).
- Watch for conjoined methods: if A requires reading B to understand, restructure (merge, inline, rename, or introduce a deeper module).
- Avoid classitis: many tiny shallow classes usually increase cognitive load.

### API ergonomics
- The common case is trivial: one obvious call, minimal config.
- Make misuse hard: encode invariants in types/constructors/module boundaries; minimize "caller must remember X".
- An interface must be explainable in 1-3 sentences. If not, redesign.

### Error handling
- Prefer to define errors out of existence when reasonable (validate/normalize/default internally).
- Mask recoverable low-level errors inside the module (retries, fallback, internal repair).
- Aggregate at boundaries: expose a small stable error surface; do not leak internal failure modes unless the caller can act on them.

### Naming and comments
- Names must create a clear image. Avoid: data, info, result, handler, manager, util.
- Comments are for why/intent/rationale, invariants/units/boundaries, and non-obvious tradeoffs.
- Write interface comments first for new modules/APIs; if hard to write, redesign before coding.
- Avoid comments that merely restate the code.

### Refactor triggers (stop and fix)
- A small change touched 3+ files.
- You introduced a new flag/option that callers must thread through.
- You duplicated logic "just this once."
- You added a helper/wrapper that mostly forwards calls.
- You cannot name something without vague words.

## Additional heuristics
- Prefer explicit data flow (args/returns) over implicit (globals, singletons, shared mutable state).
- Keep definitions near use; avoid cross-file jumping.
- Treat globals/singletons/shared mutable state as locality hazards; keep state scope narrow.
- Prefer composition over inheritance.
- Preserve substitutability: derived types preserve base observable properties.
- Default to concrete dependencies; add interfaces/DI only when multiple implementations run in the same program or swapping is an immediate need.
- Testing: prefer real implementations when feasible; avoid mocks by default.
- Compatibility: for public/external APIs/ABIs, avoid breaking users; for internal code, change freely and let compiler/tests enumerate fallout.
- Prefer deterministic, repeatable, auditable solutions.
- Do not add defensive guards when invariants guarantee correctness unless asked or evidence; keep logic explicit, minimal; avoid speculative safety checks.
- Follow "parse, don't validate": parse into concrete structures, then validate.

## Workflow
- Treat explicit user decisions as hard constraints for all subsequent steps.
- Do not re-propose previously rejected options unless a concrete blocker is identified and stated.
- Treat plan+execute as separate phases unless the user explicitly combines them.
- Ask for a clear "proceed" before any code changes when sequencing is requested.
- Re-read current file state before edits; do not overwrite user-made changes.
- Unrecognized changes: assume other agent; keep going and focus your changes. If it causes issues, stop and ask.
- Treat permission/network/sandbox failures as environment constraints: retry with escalation first, then only change approach if the solution itself is flawed.
- For DB access, assume sandbox denies sockets; plan to escalate or use an allowed path.
- When your changes create orphans, remove imports/variables/functions made unused; do not remove pre-existing dead code unless asked.
- Large/repetitive refactors: write focused scripts.
- Avoid trivial class helper methods; prefer file-scope functions.
- When a workaround stops being needed, revert names/structure to the simpler original; update all references.
- Derive optimization target from explicit constraints before choosing an implementation strategy.
- If speed/minimal edits conflicts with architecture or source-of-truth rules, follow architecture/source-of-truth.
- When finishing changes, run a self-check: "Did I optimize the thing the instructions prioritized?"
- Do not treat untracked files as disposable; require explicit user confirmation before editing or deleting any untracked path.
- when you run tools that do network requests - retry with escalation

## Tooling
- Android: Java > Kotlin.
- Frontend: component-first; reusable, composable UI.
- Repo AGENTS.md: never reference untracked files.
- GitHub: use `gh` for PRs/comments.
- Shell: run `shellcheck` on shell changes.
- TS AST transforms: prefer `ts-morph`; avoid string transforms unless necessary.
- Naming: functions/methods must express intent, not implementation.
- Public APIs: use structured doc comments (JSDoc/TSDoc). Inline comments only for local invariants or non-obvious logic.

## Type Style (Hard Rules)
- Prefer explicit, named types over inferred/meta utility types.
- Avoid type-level indirection that reduces readability (e.g., utility extraction, indexed access).
- Import domain types directly; define local aliases when clarity improves.
- Do not silence type/lint errors via casts; fix the source type.
- Exceptions (one-line justification required):
  - generic/helper libs where inference is the goal
  - framework callbacks where explicit types would duplicate unstable signatures

## Personal AGENTS.md
- Personal file: `$ACCELERANDO_HOME/ai/codex/AGENTS.md` (`realpath "$ACCELERANDO_HOME/ai/codex/AGENTS.md"`).