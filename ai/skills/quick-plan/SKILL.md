---
name: quick-plan
description: Lightweight planning workflow for producing a short, execution-oriented plan inline.
---

# Quick Plan

Produce a short, execution-oriented plan inline. Prefer conversational planning over formal artifacts.

## Core Behavior

- Read the relevant code, configs, tests, and docs before planning.
- Keep the plan concise: usually 3-7 concrete steps.
- Ask questions only when repo/environment inspection cannot resolve a material ambiguity.
- Make steps execution-ready so implementation can follow the plan without further material design choices.
- Keep output inline by default; create `plans/<slug>.md` only when the user explicitly asks for a written artifact.

## When to Use

Use `quick-plan` when:
- the user wants a lightweight or on-the-fly plan,
- one approach is already likely and heavy option analysis would be overkill,
- a short inline plan is enough to move work forward.

Stay in exploration instead when:
- the user is still problem-framing rather than planning,
- more discovery is needed before even a lightweight plan is credible.

## Planning Standard

Before giving the plan:
- inspect the concrete code paths, interfaces, configs, tests, and adjacent integration points relevant to the requested work,
- identify the most likely implementation path,
- ask only the minimum questions needed to remove material ambiguity.

Keep the plan in question-asking mode rather than final-plan mode when:
- a step still depends on choosing among materially different approaches,
- the expected touched area is still unclear after reasonable inspection,
- verification strategy is materially unclear,
- scope may expand based on an unresolved decision.

If one of those is true, ask the blocking question directly and continue once it is resolved.

## Response Shape

Use this lightweight structure:

1. `Findings` - only the code/context facts that matter for the plan.
2. `Plan` - 3-7 concrete steps.
3. `Assumptions` - brief, only if needed.
4. `Risks` - brief, only if material.
5. `Questions` - only unresolved material questions; otherwise `None.`

## Step Quality Rules

Each step should be:
- concrete enough to execute without additional material design decisions,
- scoped to a clear outcome,
- tied to expected files/areas or interfaces when useful,
- paired with a brief verification checkpoint when that affects sequencing.

Allowed during execution:
- local naming choices,
- small mechanical refactors needed to support the planned change,
- minor implementation details that stay within the approved approach.

Keep the plan explicit about:
- architecture choices that matter before coding starts,
- API and data-shape decisions that affect implementation,
- scope boundaries,
- investigation that still needs to happen before implementation begins.

## Guidance Defaults

- Prefer one good approach over forced multi-option analysis.
- Mention alternatives only when the trade-off is real and decision-relevant.
- Keep the plan conversational and terse.
- Keep the plan self-contained unless the user explicitly asks for a persisted artifact or a more formal process.
