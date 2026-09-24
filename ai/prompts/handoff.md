---
description: Preserve continuation context for a fresh agent
argument-hint: "[topic or next-session focus; optional destination]"
---

Create a handoff markdown document for a fresh agent under `docs/`, unless the
user specifies another destination.
Name it `docs/handoff-YYYY-MM-DD-<topic>.md`, using the current date and a
short kebab-case topic.

Preserve the minimum context needed to continue correctly without the original
conversation, whether the work is implementation, discussion, design, or
investigation.
If the user provided a topic or next-session focus, tailor the handoff around
that focus while preserving relevant current state.

User-provided focus or destination (if any):
$ARGUMENTS

Do not redo broad discovery. Only inspect files or git state when needed to
confirm exact paths, names, current changes, or validation results.
Reference durable artifacts such as specs, plans, ADRs, issues, commits, or diffs
by path or URL instead of copying their details. Briefly restate load-bearing
conclusions, constraints, and rationale so the next agent understands the task
before following those references.
Redact sensitive information such as API keys, tokens, passwords, secrets, and
personally identifiable information.
Prioritize current state over chronology: preserve active requirements, accepted
decisions, current file status, unresolved work, and next actions. Omit stale
drafts, superseded plans, irrelevant previous-task context, and exploratory dead
ends unless they explain a still-active constraint or rejected approach.

Organize around the following, combining overlapping material and omitting
irrelevant or empty sections:

- Goal, requested outcome, and current understanding, including important nuances.
- User-stated constraints, preferences, and rejected approaches with their reasons.
- Authorization and scope: what the user approved, whether the work is
  discussion/investigation only, and what still requires a decision or permission.
  Recommended next steps are not authorization to execute them.
- Accepted decisions and rationale, clearly separated from agent recommendations,
  tentative options, assumptions, and uncertainties.
- Current progress, remaining work, risks, blockers, edge cases, and open decisions.
- Relevant references and the next concrete action, check, question, or decision.

Include task-specific continuation context where relevant:

- Implementation: relevant files and symbols, changed files and their current
  status, repository/worktree location when needed, validation performed or still
  needed, and unresolved errors, failing commands, or broken tests.
- Investigation: hypotheses, supporting and contradicting evidence, what was ruled
  out and why, and the next check that would distinguish remaining explanations.
- Discussion/design: options still open, tradeoffs, decision criteria, unresolved
  disagreements, and the next question to settle.

Avoid irrelevant history, generic repo summaries, and exhaustive dumps.
Do not invent missing context; mark unknowns explicitly.
Separate observed facts, inferences, and assumptions when it matters.
Tie consequential claims to their source or check and state its limitations;
distinguish verified results from expectations and unperformed validation.
Prefer concise, durable, actionable notes.

Before finishing, read the handoff as if the original conversation were
unavailable: can the next agent identify the goal, current state, authorization
boundary, and next step without reconstructing the conversation? Resolve gaps
from known context or mark them unknown.
Return the saved file path to the user.