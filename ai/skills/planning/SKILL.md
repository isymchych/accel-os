---
name: planning
description: Use when the user requests a plan, or when consequential design choices, dependencies, or uncertainty need to be resolved before implementation. Not for straightforward changes with an obvious approach.
---

# Planning

Turn intent into a clear path to implementation. Use only the detail needed to
make the next work safe and understandable.

Loading this skill does not require a separate planning phase or approval
checkpoint. Continue within existing authorization; pause only for blockers or
consequential decisions requiring user input.

## Approach

- Inspect the affected flow, relevant code, tests, and guidance before proposing
  steps. Ground the plan in existing mechanisms and constraints.
- State the intended outcome and recommend one approach. Explain consequential
  choices; discuss alternatives only when they materially change the decision.
- Include design detail where it affects execution: ownership, contracts, data
  flow, invariants, or migration. Name relevant files, interfaces, and test seams
  when they clarify the work; leave routine implementation details to execution.
- Resolve questions that affect scope, safety, or the approach before dependent
  work begins. Ask only blocking questions that inspection cannot answer.
- When a decision requires experimental evidence, plan a bounded investigation:
  what it must establish, how to check it, and how the result selects the next
  step. Make assumptions and remaining uncertainty explicit.

## Steps and Checks

- Break work into meaningful, verifiable outcomes where useful. Fold setup,
  configuration, and documentation into the outcome that needs them rather than
  listing mechanical microsteps.
- For feature work, prefer thin end-to-end slices of observable behavior over
  completing technical layers separately. Include only the prerequisites each
  slice needs; use separately verifiable prerequisite steps when necessary.
  For other work, slice by preserved invariants or operational outcomes.
- Make ordering dependencies and decision checkpoints explicit. Prefer steps
  that can be completed and checked independently where practical.
- Order work to resolve consequential uncertainty early, within dependency
  constraints.
- Pair meaningful steps with focused checks and expected outcomes that
  demonstrate the intended behavior, not merely successful execution of a
  command. Include runnable commands when known and integration checks when
  needed.
- Before presenting the plan, check that it covers the requested outcome and
  constraints, that dependencies agree, and that material risks and failure modes
  have a check or mitigation.

## Presentation

- Default to a concise inline paragraph or list. Use headings only when they
  help; no fixed section list, step count, or implementation-code requirement.
- When a plan has multiple steps, use a numbered list. Keep each step focused on
  a meaningful outcome, with its check included.
- Use `plans/<slug>.md` when a durable handoff or the work's size or risk makes
  a file useful, subject to authorization. Honor a user-requested location.
  Include enough context and rationale to resume without the conversation.
- Stop when implementation can begin without guessing about the goal, approach,
  or first check. Keep the plan smaller than the work it enables.