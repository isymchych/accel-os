---
name: planning
description:
  Use when the user requests an implementation plan, or when authorized work needs sequencing and
  dependency coordination. Not for design, critique, brainstorming, or straightforward
  implementation alone.
---

# Planning

Turn an intended outcome and a clear technical direction into deliverable slices, dependencies, and
verification. Use only the detail needed to make the next work safe and understandable.

Design decisions may inform a plan, but discussing or resolving them does not itself trigger this
skill.

Loading this skill does not require a separate planning phase or approval checkpoint. Continue
within existing authorization; pause only for blockers or consequential decisions requiring user
input.

## Approach

- When a still-applicable plan exists, update its affected steps rather than generating a
  replacement plan.
- Inspect the affected flow, relevant code, tests, and guidance before proposing steps. Ground the
  plan in existing mechanisms and constraints. Reuse design evidence already established; inspect
  enough to check that the direction supports realistic slices, dependencies, and verification.
- State the intended outcome and the technical direction the plan follows. Preserve settled
  requirements, ownership, contracts, invariants, consequential constraints, dependencies, and their
  rationale. Include migration details when they constrain delivery; do not redesign boundaries or
  select a different approach as part of task breakdown.
- Surface consequential unresolved design decisions before planning dependent work. When comparing
  approaches or investigating design feasibility would help, suggest that the user invoke the
  manual-only `codebase-design` skill; do not load it automatically. A separate design exercise or
  document is not required when the direction is already clear.
- Resolve routine implementation-local choices directly when needed for an actionable plan; leave
  other implementation choices and local sequencing to the executor, who may have better context.
  Adapt those details to new evidence without reopening settled decisions. Pause affected work and
  ask before changing scope, agreed externally visible contracts, safety constraints, or the agreed
  approach.
- Resolve questions that affect scope, safety, or the approach before dependent work begins. Ask
  only blocking questions that inspection cannot answer.
- When execution uncertainty requires experimental evidence, such as checking a migration
  prerequisite, plan a bounded investigation: what it must establish, how to check it, and how the
  result selects the next step. Make assumptions and remaining uncertainty explicit. If the result
  calls the technical direction into question, return to that design decision before planning
  dependent work.

## Steps and Checks

- Organize work around coherent, separately deliverable outcomes where practical. Each slice should
  produce a useful result that can be verified and handed off; it may depend on earlier slices and
  need not be separately deployed. Fold setup, configuration, and documentation into the outcome
  that needs them rather than creating mechanical microsteps or artificially small slices.
- Prefer slices that leave the affected system coherent and usable. When an intermediate slice
  cannot do so, identify the transitional state and what subsequent work resolves it.
- Use hierarchical decomposition when it clarifies complexity, uncertainty, or dependencies: start
  with deliverable slices and break down only those that need it. Detail the next slice enough to
  begin safely; keep later slices at the outcome-and-dependency level until execution provides more
  context. Do not require a fixed number of levels.
- For feature work, prefer thin end-to-end slices of observable behavior over completing technical
  layers separately. Include only the prerequisites each slice needs; use separately verifiable
  prerequisite steps when necessary. For other work, slice by preserved invariants or operational
  outcomes.
- Make ordering dependencies and decision checkpoints explicit. Prefer steps that can be completed
  and checked independently where practical.
- Order work to resolve consequential uncertainty early, within dependency constraints.
- Give each slice observable acceptance conditions. Detail focused checks for near-term work,
  including runnable commands when known and useful, and integration checks when needed. Verify
  intended behavior, not merely successful execution of a command.
- Before presenting the plan, check that it covers the requested outcome and constraints, that
  dependencies agree, and that material risks and failure modes have a check or mitigation.
- When ordering or verification across chosen boundaries is unclear, trace a representative
  operation from entrypoint to observable outcome. Include failure or alternate paths when they
  affect dependencies or checks. Use this to verify that slices respect established ownership and
  contracts; surface a design gap rather than silently inventing a boundary or distributing a shared
  rule across callers.

## Presentation

- Default to a concise inline paragraph or list. Use headings only when they help; no fixed section
  list, step count, or implementation-code requirement.
- When a plan has multiple slices, use a numbered list with nested steps only where useful. Keep
  each slice focused on a meaningful outcome, with its acceptance conditions included.
- Use the smallest representation that resolves uncertainty: a contract sketch, composition graph,
  execution trace, state model, or before/after view. Distinguish current from proposed structure
  and dependencies from runtime sequence; label schematic code as non-executable.
- Use `plans/<slug>.md` when a durable handoff or the work's size or risk makes a file useful,
  subject to authorization. Honor a user-requested location. Include enough context and rationale to
  resume without the conversation.
- Stop when the next slice can begin without guessing about the goal, constraints, approach, or
  first check. The plan need not settle later implementation choices. Keep it smaller than the work
  it enables.