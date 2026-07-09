---
description: Critique the normative document
---

Critique **$ARGUMENTS** as a normative document.

Focus on:

- consistency
- missing rules or decision guidance
- durability and self-containment
- concision and sharpness
- noisy, historical, implementation-shaped, or duplicated wording

Return:

## Verdict

2-4 bullets.

## Priority findings

At most 5, sorted by impact.

For each:

- P0/P1/P2:
- Problem:
- Fix:

Priority:

- P0: contradiction, wrong decision, or missing required rule
- P1: ambiguous, non-durable, or weak guidance
- P2: cleanup only

## Cleanup priorities

At most 3 repeated cleanup themes worth fixing.

For each:

- Impact:
- Pattern:
- Fix:

Only include cleanup if it materially improves clarity, durability, or skimmability.
Omit purely cosmetic issues.

Review standard:

- prefer domain rules over storage/code details
- prefer self-contained wording
- remove “legacy / no longer / flat / historical / old model” style framing unless truly required
- keep negative statements only if the absence itself is an invariant
- favor durable decision rules over implementation narration

Do not produce exhaustive line-level findings.
Use quotes only when needed as evidence.
Do not edit files.
Be strict, concise, and skimmable.