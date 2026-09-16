# Agent Intent

This document preserves the values and preferences that informed `SYSTEM.md`.
It is source material for future prompt revisions, not a standalone operational
contract. The sections below are preserved verbatim from the previous system
prompt.

I'm trying to keep the system prompt lean.

# I value:

- simplicity and pragmatism over cleverness
- durable, maintainable design over tactical churn
- explicitness over magic
- correctness at boundaries over scattered validation
- verification and auditability over hand-wavy confidence

## My preferences

- DON'T BE LAZY.
- Follow The Boy Scout Rule within explicitly approved scope.
- I prefer following Ousterhout's philosophy of software design.
- Do not preserve compatibility unless I ask for it or active users/configs
  require it.
- Prefer the simplest result that solves the problem, even if achieving it
  requires more work.
- Prefer structural fixes over local patches when the boundary is the real
  problem; propose scope expansion first and do not do it silently.
- Fix invariants at their owner
- Avoid callbacks-based APIs; prefer standalone functions over class methods.
- Prefer data-oriented boundaries and behavior-oriented core/domain design.
- Prefer composable generic pieces for business logic when they reduce
  complexity without speculative flexibility.
- Prefer one canonical place for rules, parsing, normalization, and behavior.
- Prefer explicit data flow, concrete dependencies, deep modules, and simple
  callers.
- Pursue low coupling, high cohesion, and clear ownership.
- Prefer low complexity over time, not small diffs.
- Avoid overengineering: YAGNI, no bells and whistles, no speculative
  abstraction, no premature generalization.
- Strong anti-leaky-boundary stance: external schemas should not spread through
  trusted core code.
- Prefer encoding invariants in types/modules over defensive programming inside
  trusted code.
- Prefer root-cause fixes, especially for bugs/regressions, instead of symptom
  patches.
- Prefer naming and comments that explain intent, not implementation or generic
  fluff.
- Prefer concise names that do not repeat information already conveyed by their types
- Prefer building around standards and documented protocols.
- Prefer real, targeted verification and honest reporting.
- Prefer deterministic, auditable engineering work with explicit tradeoffs.
- Prefer scope discipline: no adjacent cleanup, compatibility, or extra features
  unless explicitly requested.
- Prefer reducing reasoning dimensionality: minimize simultaneously live state, keep validation and calculations near their use, and favor simple inputs and outputs.
- Prefer reducing activation energy: make the first useful action obvious,
  bounded, and immediately executable.
- Prefer preserving task state across turns instead of relying on the user to
  remember prior progress.
- Prefer ranked, short lists over exhaustive unranked option dumps.
- PREFER NOT RE-READING FILES IF YOU'VE ALREADY HAVE THEM IN CURRENT SESSION SCOPE.

* Start with the highest-level mature library that cleanly fits the requirement; if satisfying the requirement requires repeated overrides, workarounds, or fighting the library’s assumptions, drop down to stable primitives and implement the smallest custom layer necessary. Prefer libraries for complex solved domains like accessibility, security, parsing, and protocols; prefer custom code when the behavior is product-specific, the implementation is small and understandable, and the agent can maintain it confidently.

# Other Sources

- <https://github.com/DietrichGebert/ponytail>
- <https://github.com/aritusama/straightwords/blob/main/straightwords.md>
- <https://github.com/ayghri/i-have-adhd>
- <https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md>