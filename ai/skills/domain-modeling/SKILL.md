---
name: domain-modeling
description: Build, sharpen, and document a project's domain model. Use when the user wants to define domain terminology, resolve naming or rule ambiguity, model business objects/relationships/state, or reconcile domain docs with code.
disable-model-invocation: true
---

# Domain Modeling

Actively build and sharpen the project's domain model as work happens. This skill is for changing or documenting the model, not merely reading vocabulary.

Resolving a domain question does not itself authorize a document edit.

Prefer project-local domain documents such as `docs/domain-model.md` as the canonical domain context.

## Source Of Truth

Find the relevant domain context in this order:

1. A path explicitly named by the user.
2. Existing project docs matching `docs/**/domain*.md`, `docs/**/model*.md`, or `docs/**/glossary*.md`.
3. Existing ADRs under `docs/**/adr/` when the question involves architectural tradeoffs.
4. Relevant code and tests.
5. If no domain document exists, propose `docs/domain-model.md` before creating it.

For multi-domain repositories, prefer the narrowest matching domain doc near the affected code or docs. If two plausible domain docs conflict and the correct owner is unclear, ask which one is authoritative.

## Workflow

### 1) Establish The Domain Boundary

- Identify the business capability, workflow, or subdomain being modeled.
- State what is explicitly outside the model.
- Use business language; avoid implementation details unless comparing docs against code.

### 2) Challenge Fuzzy Terms

- When the user uses an overloaded term, propose precise candidate meanings.
- When user language conflicts with the documented glossary or model, call it out immediately.
- Do not silently normalize distinct concepts into one term.

### 3) Stress-Test With Scenarios

- Invent concrete edge-case scenarios that force precise rules and boundaries.
- Test relationship cardinality, ownership, lifecycle, exceptions, and state transitions.
- Prefer examples that reveal whether two terms are truly different business concepts.

### 4) Cross-Reference With Evidence

- Base the model on existing code and documentation when available.
- Clearly distinguish:
  - `Verified facts` from docs/code/tests;
  - `Assumptions` inferred from incomplete evidence;
  - `Open questions` that require user or domain-expert input.
- If code contradicts a domain claim, surface the contradiction and ask which source should change.

### 5) Update The Domain Document

- When documentation changes are authorized, update docs when a term, rule, relationship, boundary, or transition is resolved. Otherwise present the proposed update.
- Do not batch resolved domain facts unnecessarily; capture them while the context is fresh.
- Do not document guesses as facts.
- If available evidence is insufficient, ask targeted questions before writing unsupported claims.

## Domain Document Shape

Use this structure unless an existing domain document has a clear project-local format:

1. `Scope And Boundaries`
   - included domain scope;
   - explicitly excluded concepts or workflows.
2. `Domain Objects`
   - object names;
   - business purpose;
   - lifecycle owner when business-relevant.
3. `Relationships`
   - relationship names;
   - cardinality;
   - ownership or dependency when business-relevant.
4. `Business Rules And Invariants`
   - rules that must always hold;
   - object, state, and exception each rule applies to.
5. `States And Transitions`
   - states;
   - allowed source and target states;
   - triggering business event;
   - invalid transitions when meaningful.
6. `Glossary`
   - canonical terms;
   - rejected or ambiguous synonyms when useful.
7. `Assumptions`
   - plausible but unverified conclusions.
8. `Open Questions`
   - unresolved ambiguity, contradictions, and missing rules.

## ADR Boundary

Domain facts belong in the domain model. Implementation or architecture choices belong in ADRs.

Offer an ADR only when all are true:

1. The decision is hard to reverse.
2. A future reader would find the choice surprising without context.
3. The choice resolved a real tradeoff between credible alternatives.

If any condition is missing, update the domain model or existing docs instead of creating an ADR.

## Guardrails

- Create or update project-local domain docs.
- Do not treat a domain model as an implementation spec.
- Do not let external schemas, database tables, API names, or code structure define domain language by default.
- Do not erase documented ambiguity unless the user or evidence resolves it.