---
description: Serialize current agent state into a handoff for a fresh coding agent
---

Create a context-free handoff markdown document under `docs/` for a fresh agent.
Name it `docs/handoff-YYYY-MM-DD-<topic>.md`, using the current date and a
short kebab-case topic.

Focus on serializing the current agent state: important context, nuances,
decisions, assumptions, unresolved questions, plans, risks, and references needed
to continue the work without prior chat history.

Do not redo broad discovery. Only inspect files or git state when needed to
confirm exact paths, names, current changes, or validation results.

Include:

- Goal / requested outcome
- Current understanding of the problem
- Important context and nuances
- User-stated constraints, preferences, and rejected approaches
- Decisions made and rationale
- Assumptions and uncertainties
- Relevant files, symbols, docs, or commands
- Work completed so far
- Remaining tasks / recommended next steps
- The next concrete action or command for the fresh agent
- Validation performed or still needed
- Known risks, blockers, or edge cases

Avoid irrelevant history, generic repo summaries, and exhaustive dumps.
Do not invent missing context; mark unknowns explicitly.
Separate observed facts, inferences, and assumptions when it matters.
Prefer concise, durable, actionable notes.