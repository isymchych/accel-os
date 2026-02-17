# Architecture Guidelines for a Coding Agent

## Goal
Produce changes that are easy to understand, easy to modify, and hard to misuse. Optimize for **long-term complexity reduction**: fewer dependencies, less obscurity, lower cognitive load.

## Definition of “Good Architecture”
A change is architecturally good if it:
- Reduces or contains complexity.
- Localizes knowledge (information hiding).
- Minimizes ripple effects for future changes.
- Makes the “right usage” the easiest usage.

## Complexity Heuristics
Track these continuously while planning and coding:

- **Dependencies**: “If I change X, what else breaks?”
- **Obscurity**: “Will a new reader know what this means and why it exists?”
- **Symptoms**:
  - *Change amplification*
  - *Cognitive load*
  - *Unknown unknowns* (hard to predict what to modify)

## Architectural Strategy
### Work strategically (not just tactically)
For each task, reserve ~10–20% effort for design improvement:
- tighten interfaces
- improve names
- reduce coupling
- delete dead paths
- add/adjust tests as a structural safety net

### Prefer deep modules
A **deep module** has:
- small/simple public surface
- strong guarantees
- internal complexity hidden behind the interface

Avoid **shallow modules**:
- pass-through wrappers
- “types-only” abstractions with little behavior
- proliferation of tiny classes/files that add navigation cost

## Module & Layering Rules
### Information hiding first
- Encapsulate decisions that are likely to change (formats, protocols, storage layout, parsing rules, concurrency strategy).
- Never leak internal representation into callers.
- If the same decision is encoded in 2+ places, refactor until it has a single home.

### Layer separation must change abstraction
- Adjacent layers must not mirror each other.
- “One method that forwards to another with the same arguments” is a red flag.
- Higher layers should talk in domain concepts; lower layers in mechanisms.

### Pull complexity downward
If something is tricky (validation, edge cases, retries, defaulting, normalization):
- handle it inside the module that owns the data/mechanism
- expose a simpler contract upwards

### Avoid temporal decomposition
Don’t decompose primarily by “step order” (read → parse → process) unless it aligns with stable responsibilities.
Prefer decomposition by knowledge and invariants:
- parsing module owns parsing rules
- storage module owns storage invariants
- domain module owns domain constraints

## Interface Design Checklist
Before implementing, ensure the interface is:
- **Small**: minimal methods and parameters.
- **Obvious**: correct usage is easy; incorrect usage is hard.
- **General enough**: supports plausible near-future uses without speculating.
- **Precise**: invariants and units are explicit.
- **Stable**: hides change-prone details.

Interface red flags:
- many flags/booleans
- “mode” parameters
- mirrored methods across layers
- caller must know internal ordering rules
- caller must manually assemble invariants

## Error Handling Policy
Goal: minimize error-handling burden on callers.
- Prefer designing APIs so common misuse is impossible or safely handled.
- Mask low-level errors where they occur (retry/backoff/defaulting) when that’s the owner’s responsibility.
- Aggregate errors into a small number of meaningful categories at boundaries.
- Errors are part of the interface: define semantics, not just types.

## Naming & Documentation
### Naming
Names must create a clear mental image:
- Use domain terms, not implementation terms.
- Avoid vague names (`data`, `result`, `info`, `manager`).
- Encode constraints when helpful (`NonEmpty…`, `Normalized…`, `Validated…`).

### Comments
Comments are for **intent and contracts**, not narration.
- Explain *why* a decision exists, tradeoffs, and invariants.
- Add precision: units, bounds, concurrency expectations, ownership.
- If a comment is hard to write, the interface is probably too complex.

Write public interface docs **before** coding the implementation.

## Planning Template (Agent Internal)
For any non-trivial change, produce a short plan:

1. **Problem statement** (1–3 sentences)
2. **Desired invariants** (bulleted)
3. **Proposed modules / boundaries**
4. **Interface sketch** (signatures / types / endpoints)
5. **Complexity risks** (deps, obscurity, unknowns)
6. **Alternatives considered** (at least 2, with tradeoffs)
7. **Migration / rollout** (if needed)
8. **Test strategy** (what proves the invariants)

## Architectural Red Flags (Stop and Refactor)
- Pass-through methods / mirrored layers
- Same knowledge copied in multiple places
- Flag-driven APIs / “mode soup”
- Conjoined components that must be read together
- Hidden ordering constraints
- Abstractions that save implementer effort but cost every caller
- More files/classes created than concepts introduced

## Acceptance Criteria for a PR
A PR is “architecturally acceptable” if:
- Interfaces are smaller or clearer than before (or justified if larger).
- Knowledge is more localized (less leakage).
- Tests enforce key invariants.
- The change reduces future change amplification.
- The plan’s alternatives and tradeoffs are documented (briefly) for non-obvious decisions.