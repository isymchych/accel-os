# How to Write Code for Coding Agents

_Principles for making your JS/TS/Rust code easy to read, extend, and refactor by SOTA coding agents._

---

## 1. General Principles

- Prefer **boring, conventional patterns** over cleverness.
- Keep **logic local and explicit**; avoid deep indirection and “magic”.
- Encode **invariants in types and tests** instead of tribal knowledge.
- Use **consistent naming and structure** across the repo.

Ask: “Can an agent safely change this file by understanding only this file and its immediate neighbors?”

---

## 2. Project Layout & Architecture

**Do:**

- Use standard, predictable layouts:
  - JS/TS: `src/`, `tests/`, feature-based folders, common framework conventions.
  - Rust: cargo workspace, `src/lib.rs`, `src/main.rs`, `tests/`, `benches/`.
- Separate concerns:
  - `domain/` or `core/` – pure business logic, no I/O.
  - `infra/` or `adapters/` – DB, HTTP, queues.
  - `app/` or `api/` – entrypoints, wiring.
- Make module boundaries explicit:
  - TS: explicit `export` lists per module/package.
  - Rust: minimal `pub`, use `pub(crate)` / `pub(super)` intentionally.

**Avoid:**

- Custom “meta-frameworks” with undocumented conventions.
- Mixing generated and handwritten code in the same directories or files.

---

## 3. Types, Interfaces, and Contracts

**Do:**

- Use types to express semantics, not just shapes:
  - TS: prefer specific types, discriminated unions, branded types over `any` / wide unions.
  - Rust: newtypes, enums, `Result<T, E>`, and domain-specific error types.
- Keep function signatures honest:
  - Inputs are arguments; outputs are return values.
  - Avoid “sometimes returns null/undefined” unless that’s the real invariant.
- Centralize key domain types:
  - Each major concept has a canonical type/interface/struct.
  - Reuse them instead of ad-hoc copies.

**Avoid:**

- Over-generalized, overly clever generics that obscure intent.
- Types that lie about nullability / error behavior.

---

## 4. Functions, Methods, and Modules

**Do:**

- Prefer **small, single-responsibility functions**.
- Make data flow obvious:
  - No surprising mutations of shared structures.
  - Clear ownership and lifetime (especially in Rust).
- Keep modules cohesive:
  - Each file/module has a clear purpose, summarized in a short header comment if non-obvious.

**Avoid:**

- God functions / god objects with many unrelated responsibilities.
- Tight coupling via implicit globals or singletons.

---

## 5. Tests as Behavioral Specs

**Do:**

- Write tests that describe **observable behavior**, not implementation details.
- Prioritize:
  - Unit tests for core domain logic.
  - A few integration/e2e tests for critical flows.
- Use descriptive names:
  - `it_rejects_expired_tokens`
  - `handles_concurrent_balance_updates`

**Avoid:**

- Flaky tests (timing, random, external network).
- Overspecified tests that assert internal structure rather than outputs.

**Guideline:**

> If an agent rewrites the implementation but keeps tests green, the system should still be correct.

---

## 6. Naming and Documentation

**Do:**

- Use domain-meaningful names:
  - `UserSessionToken`, `ReconcileLedger`, `ApplyDiscount`.
- Keep naming consistent across layers:
  - Same concept → same name (not `Invoice` in one place, `Bill` in another).
- Add focused docs where they pay off most:
  - `ARCHITECTURE.md` at repo root, high-level map.
  - Short module headers for non-obvious modules.
  - Inline comments for invariants, constraints, and non-obvious hacks.

Example invariant comments:

- `// IDs are ULIDs; sorting by string order == chronological`
- `// Called on hot path; avoid allocations`

**Avoid:**

- Generic names (`Util`, `Manager`, `Processor`, `Service`) without context.
- Narrative comments that restate obvious code.

---

## 7. “Magic”, Metaprogramming, and Codegen

**Do:**

- Keep metaprogramming simple, documented, and localized.
- Clearly separate generated code:
  - Dedicated `generated/` or `codegen/` directories.
  - Never hand-edit generated files.
- Provide one level of readable abstraction on top of complex macros/decorators.

**Avoid:**

- Heavily overloaded macros or decorators that radically change semantics.
- Hidden behavior triggered by naming/folder conventions with no docs.

Heuristic: if a human must run `cargo expand` or inspect compiled JS to understand behavior, an agent will struggle too.

---

## 8. State, Side Effects, and Dependencies

**Do:**

- Prefer pure functions for domain logic.
- Isolate side effects to boundaries:
  - HTTP handlers, DB repositories, adapters.
- Use dependency injection (or simple parameter passing) over global singletons.
- Make context explicit:
  - Pass request context, tenant, feature flags as arguments, not thread-locals.

**Avoid:**

- Global mutable state.
- Hidden cross-cutting side effects (logging, metrics, caching) baked into core logic.

---

## 9. Invariants, Migrations, and Long-Lived Decisions

**Do:**

- Capture important decisions and invariants in short docs:
  - ADRs (Architecture Decision Records) or `docs/` with 1–2 page notes.
- For migrations (e.g., old API → new API, JS → TS):
  - Physically separate old vs new paths.
  - Write explicit rules: what’s allowed where, and what the target state is.

Example rules:

- “New endpoints must use v2 DTOs; v1 only receives bugfixes.”
- “All new modules must be strict TS; JS is legacy only.”

**Avoid:**

- Half-migrated systems with no indication of which path is canonical.
- Implicit rules that only exist in people’s heads.

---

## 10. Practical Checklist Before Letting an Agent Loose

Before asking a coding agent to refactor or extend a project, check:

- [ ] Core domain types are well-defined and reused.
- [ ] There are tests covering key behaviors and hot paths.
- [ ] Project structure is conventional and layered.
- [ ] Major invariants are documented (types, comments, or ADRs).
- [ ] Metaprogramming/macros are documented and constrained.
- [ ] Global/mutable state is minimized or clearly isolated.
- [ ] There is a clear “old vs new” separation for any ongoing migrations.

If these boxes are mostly checked, a SOTA coding agent can usually perform non-trivial refactors and feature work with high reliability.