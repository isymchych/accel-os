---
name: architecture-review
description: Architecture-focused review for boundary design, information leakage, dependency shape, and long-term complexity risk. Trigger when the user asks for "architecture review" (or equivalent), especially when a PR changes module interfaces, ownership boundaries, layering, shared data flow, or introduces refactors likely to affect maintainability.
---

# Architecture Review

Evaluate structural quality, not line-level bugs. Focus on decisions that change dependency direction, abstraction depth, and where complexity lives.

## Review Scope

- Module boundaries and contracts
- Information leakage and duplicated decisions
- Pass-through layers and mirrored abstractions
- Call-site complexity versus callee complexity
- Migration risk for boundary changes

## Workflow

### 1) Map The Change Boundary
- Identify changed modules and their public interfaces.
- Note new dependencies, moved responsibilities, and altered ownership.
- Ignore internal details unless they affect the boundary.

### 2) Trace Design Decisions
- Find every place each design decision appears.
- Flag repeated decisions across modules as leakage.
- Prefer one authoritative module per decision.

### 3) Check Depth And Layering
- Flag pass-through functions/classes that only mirror another API.
- Check whether adjacent layers expose the same abstraction.
- Prefer deeper modules with simpler caller APIs.

### 4) Assess Cognitive Load
- Count concepts a caller must hold to use the change correctly.
- Verify common paths stay obvious and low-configuration.
- Flag interfaces that cannot be explained in 1-3 sentences.

### 5) Evaluate Change Amplification
- If one behavior tweak requires edits in 3+ files, find the leaked decision.
- Recommend centralizing at a stronger boundary.
- Prefer reducing call-site complexity even if callee complexity increases.

### 6) Classify Migration Impact
- Explicitly mark whether recommendations are backward-compatible.
- For breaking changes, list required migration steps and blast radius.

## Output Format

Return sections in this order:

1) `Architecture Findings`
- Ordered by severity then blast radius.
- Each finding includes:
  - `Severity`: `critical` | `high` | `medium` | `low`
  - `Confidence`: `high` | `medium` | `low`
  - `Boundary`: module(s)/interface(s) affected
  - `Evidence`: concrete structure/code references
  - `Risk`: long-term complexity or regression mode
  - `Recommendation`: concrete redesign
  - `Compatibility`: `compatible` | `breaking`
  - `Migration`: required only when `breaking`

2) `Architecture Checklist`
- Answer each with `Yes`, `No`, or `Partial` plus one evidence sentence:
  - Did this reduce dependencies or obscurity?
  - Did this introduce information leakage?
  - Any new pass-through layers?
  - Are callers simpler than before?
  - Is each interface explainable in <=3 sentences?
  - Is ownership obvious to a new reader?

3) `Assumptions`
- Include only if conventions or architecture intent are inferred.

4) `Overall Architecture Verdict`
- Use exactly one:
  - `Architecture healthy`
  - `Architecture risk: targeted refactor advised`
  - `Architecture risk: redesign advised`

## Guardrails

- Do not do full line-by-line bug review here.
- Do not report style-only nits.
- Do not invent architecture goals; state assumptions when intent is unclear.
