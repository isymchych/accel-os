# Engineering Guidelines

## Goal

Produce changes that are easy to understand, easy to modify, and hard to misuse. Prefer durable
simplicity over cleverness or unnecessary compatibility layers.

## Design principles

- Prefer low coupling, high cohesion, and explicit data flow.
- Put each rule, parser, normalization step, and invariant in one canonical owner.
- Hide change-prone decisions behind deep modules with small public surfaces.
- Keep external schemas at boundaries; normalize into trusted domain types before core logic.
- Prefer standalone functions and data-oriented boundaries; avoid callbacks and classes unless they
  clearly simplify ownership.
- Encode invariants in types, constructors, schemas, modules, and tests instead of scattered
  defensive checks.
- Do not add abstraction unless it materially reduces complexity for callers or centralizes real
  policy.

## Boundaries

Good boundaries change abstraction level:

- boundary/adapters: external formats, IO, CLI/API/DB schemas, validation, normalization;
- core/domain: trusted types, business rules, behavior, invariants;
- app/wiring: composition and orchestration.

Red flags:

- pass-through wrappers or mirrored layers;
- flag-driven APIs or mode parameters;
- callers manually assembling invariants;
- domain code depending on transport/storage shapes;
- the same rule copied in multiple places;
- many files/classes without new concepts.

## Interfaces

A good interface is small, precise, and hard to misuse.

- Use domain terms and explicit units/constraints.
- Prefer named domain/result types over nested utility types.
- Avoid broad unions, `any`, misleading nullability, and hidden ordering requirements.
- Aggregate low-level errors into meaningful boundary errors when that simplifies callers.
- Public comments should explain intent, invariants, trade-offs, or contracts, not narrate code.

## Code style

- Use boring, conventional structure.
- Keep logic local and readable; avoid magic, implicit globals, and deep indirection.
- Prefer pure functions for core logic.
- Isolate side effects at boundaries.
- Prefer return values over mutating output accumulators unless streaming/performance/API
  constraints justify mutation.
- Inline private helpers used once when the helper name does not add meaning.
- Remove shallow pass-through helpers unless they centralize reusable policy or provide a stable
  semantic boundary.
- Avoid type-level indirection that makes contracts harder to read.

## Testing

Tests should lock observable behavior and important invariants.

Add or update tests when:

- a new reusable boundary transforms, validates, or interprets data;
- multiple call sites depend on a new trust point;
- behavior branches on null/error/fallback cases;
- API/DB/domain mapping changes;
- fixing a contract bug or regression.

Prefer targeted tests close to the enforcing layer. If a behavior is hard to test, reconsider the
boundary.

## Cleanup workflow

For cleanup/refactor tasks:

1. Critique the current design first.
2. Identify the canonical owner for each rule/invariant.
3. Remove dead abstractions, duplicate policy, and leftover compatibility paths inside scope.
4. Run targeted verification.
5. Do one final pass for names, comments, and unnecessary indirection.

Do not turn cleanup into unrelated feature work.

## Review checklist

Before finalizing a change, ask:

- Does behavior match intent under edge cases and failures?
- Are invariants enforced centrally?
- Did the change reduce or contain complexity?
- Are boundaries cleaner, or at least not worse?
- Are tests placed at the right trust boundary?
- Would a new maintainer know where to change this later?