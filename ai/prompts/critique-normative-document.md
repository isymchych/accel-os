---
description: Critique the normative document
---

Critique **$ARGUMENTS** as a normative document.

Evaluate:
- internal consistency
- gaps in required rules, constraints, or decision guidance
- concision and sharpness
- whether wording is durable, self-contained, and domain-shaped

Flag weak text that uses:
- implementation-shaped wording,
- migration/history/chronology language,
- undefined shorthand,
- negative phrasing about missing implementation details instead of direct domain rules,
- duplication or noisy wording.

Return:

## Overall assessment
- Is it internally consistent?
- Biggest gaps or missing rules
- Is it concise and sharp?
- Top 3 highest-value improvements

## High-value improvements / additions
For each:
- section
- issue
- why it matters
- concise recommended addition or rewrite

## Low-value cleanup
Include redundancies, weak phrasing, and implementation-chronology/history language that should be removed or simplified.

## Line-level findings
For each finding, return:
- section
- quoted text
- why it is weak
- a concise suggested rewrite in durable present-tense domain language

Review standard:
- prefer domain rules over storage/code details
- prefer self-contained wording
- remove “legacy / no longer / flat / historical / old model” style framing unless truly required
- keep negative statements only if the absence itself is an invariant
- favor durable decision rules over implementation narration

Do not edit files. Be strict, high-signal, and concise.
