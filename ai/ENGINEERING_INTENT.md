# Engineering Intent

This records my engineering preferences and the tradeoffs behind them. It is source material for
engineering discussions and revisions to agent guidance, not an additional operational contract or a
document to load for every task. Agent behavior lives in [SYSTEM.md](SYSTEM.md); repository commands
and conventions live in [AGENTS.md](../AGENTS.md).

## Simplicity over time

- I prefer Ousterhout's philosophy of software design: deep modules with small public surfaces that
  hide meaningful complexity.
- The goal is code that is easy to understand, modify, and hard to misuse, not the smallest diff or
  the quickest patch. A simpler result can justify more implementation work.
- I value low coupling, high cohesion, clear ownership, explicit data flow, and concrete
  dependencies.
- Abstractions earn their place by reducing caller complexity or centralizing real policy.
  Composable generic business-logic pieces are useful when they simplify the current problem, not
  when they anticipate hypothetical reuse. YAGNI matters more than speculative flexibility.
- Pass-through wrappers, mirrored layers, flag-driven APIs, and many files without new concepts are
  reasons to question a design, not automatic removal rules.
- A helper can earn its place by owning reusable policy or providing a stable semantic boundary. A
  private helper used once is useful only when its name or boundary makes the code easier to
  understand.

## Ownership and trust boundaries

- I prefer data-oriented boundaries and behavior-oriented core/domain design:
  - Adapters own external formats, IO, validation, and normalization.
  - The domain owns business behavior over trusted data.
  - Application wiring composes them.
- Provider-specific assumptions belong at the boundary, without conversion layers that add no useful
  invariant or simplification.
- Rules, parsing, normalization, and behavior that must stay consistent belong in one canonical
  owner. Similar-looking code alone is not a reason to share an abstraction.
- I prefer invariants encoded in types, constructors, schemas, and module boundaries over scattered
  defensive checks inside trusted code. Callers should not have to reconstruct those invariants
  themselves.

## Readable code and interfaces

- I prefer direct composition over unnecessary callbacks, and standalone functions when a class has
  no meaningful ownership.
- Pure core logic and side effects isolated at boundaries make behavior easier to reason about.
- I value fewer simultaneously live states, validation and calculations near their use, and simple
  inputs and outputs.
- Return values are usually clearer than mutated output accumulators, with room for streaming,
  performance, or API constraints.
- Conventional local code is preferable to implicit globals, magic, or clever indirection.
- Interfaces should use domain terms, explicit units and constraints, and named domain/result types.
  Broad unions, `any`, misleading nullability, hidden ordering requirements, and nested type-level
  indirection can move complexity onto callers.
- Aggregating low-level errors is useful when it gives callers a meaningful boundary error.
- Names should be concise without repeating their types. Comments are valuable for intent,
  invariants, tradeoffs, and non-obvious contracts, rather than narrating implementation.

## Libraries and protocols

- I prefer standards and documented protocols, starting with the highest-level mature library that
  cleanly fits the requirement.
- Libraries are especially valuable for complex solved domains such as accessibility, security,
  parsing, and protocols.
- Repeated overrides or workarounds can mean the abstraction is wrong for the problem. In that case,
  I prefer stable primitives and the smallest necessary custom layer.
- Custom code is reasonable for product-specific behavior when it is small, understandable, and
  confidently maintainable.

## Fixes, compatibility, and recovery

- I prefer root-cause fixes over symptom patches, especially for regressions. The affected invariant
  belongs at its owner; a structural correction can be better than another local guard. That
  preference does not authorize silent scope expansion or unrelated cleanup.
- Compatibility is worth preserving when I ask for it or active users/configurations require it, not
  merely because a path already exists.
- Required cleanup and error reporting remain important.
- Retries, fallbacks, and other recovery should serve evidenced operational needs or supported
  contracts; otherwise I prefer a clear failure over concealed problems.

## Verification that earns its cost

- I value tests that protect observable behavior and consequential invariants, rather than test
  volume or a completed checklist.
- Shared trust boundaries, external-data mappings, null/error branches, fallbacks, and regressions
  are useful places to evaluate that value.
- I prefer targeted tests near the enforcing layer and expectations that challenge plausible wrong
  implementations.
- Difficulty testing a behavior can be evidence that its ownership or boundary needs
  reconsideration.
- Cleanup and refactoring should leave the affected design more coherent, with checks that
  demonstrate the intended outcome rather than merely a passing command.