---
name: codebase-design
description:
  Design a technical implementation grounded in the codebase. Explore viable approaches, investigate
  constraints and friction, and iterate toward a recommendation. Use with a feature spec or rough
  idea, including feasibility questions. Not for implementation sequencing, architecture review
  alone, or straightforward coding with an already settled approach.
disable-model-invocation: true
---

# Codebase Design

Turn a goal into a supported technical direction. Determine what fits this codebase, why it fits,
and which consequential decisions remain before implementation planning.

Accept a feature spec, a rough idea, or an existing design under discussion. A formal spec is not a
prerequisite. Scale the investigation to uncertainty and consequences; the sections below are
thinking moves, not mandatory phases or artifacts.

## Scope and Authorization

Investigate and discuss by default. Design work does not authorize code changes, prototypes,
document writes, or external actions. Run clearly read-only diagnostics; propose a bounded
experiment when feasibility requires state-changing work and obtain authorization before running it.
Write a technical design document only when requested or already authorized.

Reuse established context, evidence, and settled decisions. Do not restart discovery or add approval
checkpoints merely because this skill was loaded. Design selection does not itself authorize
planning or implementation.

## Frame the Question

- Establish the intended outcome, relevant constraints, and what remains negotiable. With a rough
  idea, clarify only enough to investigate usefulness and feasibility; do not turn exploration into
  a requirements interview.
- Distinguish required behavior, observed implementation, proposed choices, and unverified
  assumptions. Do not invent product requirements or quality targets to complete a design.
- Ask about preferences, trade-offs, and unavailable context when the answer could materially change
  the direction. Find inspectable facts yourself.

## Challenge Before Optimizing

Question requirements and assumptions before optimizing a proposed mechanism. Separate the desired
outcome from the requested solution: what need does a constraint protect, what evidence supports it,
and what would happen if it were relaxed? For example, distinguish real-time synchronization from
the need to show fresh data when a page opens.

- Be candid, not contrarian. Ground a challenge in a concrete cost, contradiction, unsupported
  assumption, or credible simpler alternative rather than generic requests for reassurance.
- Explain the consequence and trade-off: "This requirement introduces X because Y. If the goal is Z,
  approach A avoids X but accepts B. Is Y necessary?"
- Distinguish unusual but intentional requirements from unsupported ones. Propose changes rather
  than silently dropping or rewriting requirements; engineering simplicity does not override the
  user's priorities. Once a trade-off is knowingly accepted, design within it unless new evidence or
  changed requirements materially challenges it.

Consider deletion before simplification, and simplify what remains necessary before pursuing speed
or automation. Reduce concepts, states, interfaces, dependencies, and caller obligations while
preserving the intended outcome. Shorten the feedback loop with the smallest check that could
invalidate the design; pursue runtime optimization when actual constraints justify it. When
automation is relevant, first establish that the process is necessary and sufficiently understood.
These are decision lenses, not five required stages or a requirement to automate.

## Ground the Design in the Codebase

- Inspect relevant guidance, implementation, contracts, dependencies, and checks. Trace a
  representative operation from entrypoint to observable outcome, including failure or alternate
  paths when they affect the design.
- Identify existing owners, reusable capabilities, integration points, and concrete friction.
  Explain where the feature fits rather than inventorying the repository.
- Treat existing code as evidence, not an automatic requirement to preserve its structure. Identify
  load-bearing behavior and compatibility constraints before proposing to replace a mechanism;
  distinguish confirmed intent from uncertain rationale.

## Develop Credible Alternatives

Explore genuinely different approaches when viable, usually two or three. One supported approach is
better than manufactured competition. Include the smallest extension of the current system as a
baseline when credible.

Consider subtraction as an alternative: can the outcome be achieved without a new service,
persistent state, configuration option, workflow step, or the feature itself? Present it when
credible, making any proposed change to the required outcome explicit.

Differentiate options by consequential choices: responsibility placement, dependency direction,
state ownership, synchronous versus asynchronous work, or reuse versus a new capability. Cosmetic
variations in names or file layout are not alternative designs.

For each promising approach, show enough to reason concretely:

- Responsibilities, integration points, and what complexity is hidden from callers.
- A representative caller example, contract sketch, or data flow.
- Important invariants and boundary behavior, including failures and validation where relevant.
- The deciding trade-off, concrete constraints, and unresolved feasibility questions.

Prefer cohesive ownership and a small interface that hides meaningful complexity. An interface
includes what callers must know about ordering, errors, configuration, and other consequential
behavior, not just types. Keep shared rules with their owner rather than distributing them across
callers. Justify new layers or dependencies by a concrete need, not hypothetical flexibility.

Compare options against the actual goal and constraints: caller burden, locality of change,
integration and migration cost, operational behavior, and verifiability where they distinguish the
options. Do not require every lens for every design.

## Investigate and Iterate

- Identify what could invalidate a promising approach or change the recommendation. Seek evidence
  that distinguishes the options instead of merely collecting support for the first idea.
- Resolve inspectable uncertainty through focused code, test, or documentation investigation. When
  an experiment is needed, specify what it must establish, its bounds, and how the result changes
  the decision. Keep untested feasibility claims conditional.
- Present the meaningful trade-offs and your best current recommendation. Let the user challenge,
  combine, or refine approaches; investigate the affected assumptions rather than regenerating the
  whole design.
- Preserve settled decisions and their rationale. Reopen them when new evidence or changed
  requirements materially challenges them, not simply because another option is imaginable.

## Converge and Hand Off

Recommend an approach and explain the deciding trade-off. Preserve meaningful rejected alternatives
and why they lost, without retaining an investigation diary. A viable outcome may also be a
conditional recommendation pending a specific check, or a recommendation not to proceed.

Before concluding, check the proposed direction against the intended behavior and the representative
flow. Make material gaps, assumptions, and remaining decisions visible. Distinguish evidence of
feasibility from a proposed verification strategy or an unrun experiment.

Stop when planning can proceed without guessing about consequential design decisions, or when a
specific blocker prevents that. Leave local helper, file, and method choices open unless they
establish a necessary contract or resolve uncertainty.

Default to a concise inline design discussion. Use sketches or diagrams only when they clarify a
decision; distinguish current from proposed structure and label schematic code as non-executable. No
document is required.

When the user requests a durable technical design, follow
`$ACCEL_OS/ai/skills/project-docs/SKILL.md` for artifact structure and placement. Preserve the goal,
constraints, chosen direction, rationale, and unresolved questions needed to resume without the
conversation.

When planning is requested, use `$ACCEL_OS/ai/skills/planning/SKILL.md` for delivery sequencing and
verification planning. Carry forward the design decisions and evidence rather than restarting
discovery or duplicating the planning workflow here.