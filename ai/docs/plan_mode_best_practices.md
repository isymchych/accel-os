## Best Practices for Planning in CLI-Based Coding Agents

This document outlines how to make CLI coding agents reliable via structured planning.

### A. Planning Strategies

**1. Chain-of-Thought (step-by-step reasoning)**

* Explicit decomposition improves reliability.
* Makes reasoning auditable before execution.

**2. Hierarchical Goal Decomposition**

* Break large goals into sub-goals.
* Plan first, then implement piecewise.
* Prevents scope loss and missed requirements.

**3. Scratchpads / Intermediate Reasoning**

* Use persistent files (e.g., `CLAUDE.md`, `AGENTS.md`) as working memory.
* Store decisions, constraints, and lessons learned.
* Improves continuity and avoids repeated mistakes.

**4. Self-Reflection / Refinement**

* Agent reviews its own plan/output.
* Ask: “Does this meet the goal?”
* Catch issues before execution.

---

### B. Architectural Patterns

**1. Planner → Executor Pattern**

* Explicit separation:

  * Planner produces inspectable plan.
  * Executor follows it.
* Prevents requirement drift.
* Improves debuggability.

**2. ReAct / Loop-Based Execution**

* Reason → Act → Observe → Adjust cycles.
* Useful, but opaque if reasoning isn’t exposed.
* Best practice: allow switching to plan-first mode.

**3. Planner–Executor–Critic Loop**
Add a **Critic**:

* Evaluate results against goals.
* Run tests.
* Trigger revisions.

**4. Iterative Self-Debug Loops**

* Generate → Execute → Catch errors → Fix → Repeat.
* Cap iterations to avoid infinite loops.

---

### C. Human-in-the-Loop Workflows

**1. Persistent Context Management**

* Maintain shared project memory.
* Update context files explicitly.
* Regularly inspect agent state.

**2. Review Plans Before Execution**

* No blind coding.
* Update plan when requirements shift.
* Document non-goals.

**3. Approval Gates & Safety Nets**

* Review diffs before applying.
* Run tests automatically.
* Use execution approvals for risky changes.

---

**Core theme:**
Reliable agentic coding emerges from:

* Explicit planning
* Separation of reasoning and execution
* Iterative verification
* Persistent memory
* Human supervision at control points

Not from raw model intelligence alone.

-------------------------

## High-level best practices for long-horizon Codex tasks:

* **Freeze the target in a spec file**: goals/non-goals, hard constraints, deliverables, and explicit “done when” checks so the agent doesn’t build something impressive-but-wrong. 
* **Decompose into checkpointed milestones**: small steps the agent can complete in one loop, each with acceptance criteria + concrete validation commands (tests, lint, typecheck, deterministic snapshots).
* **Adopt a hard “stop-and-fix” rule:** if a validation fails, repair before moving on (prevents compounding failures and drift). 
* **Use an execution runbook**: tell the agent how to operate—follow the plan, keep diffs scoped, run validations after each milestone, and keep documentation updated. 
  * Resolve ambiguity by writing it down first: if something’s unclear, decide and record the decision before coding (keeps the plan as the canonical spec).
  * Milestone exit criteria is stricter than “run tests”: after every milestone: run verification (lint/typecheck/unit tests/snapshots/integration checks), fix failures immediately, and add/update tests covering the milestone’s core behavior.
  * Bug protocol: if any bug is found: write failing test → fix → confirm pass → add a short note in “Implementation Notes”.
* **Maintain a live status + audit log**: current milestone status, decisions (and why), how to run/demo, known issues—so you can pause/resume without losing context. 
* **Continuous verification beats “prompt cleverness”:** keep tests/lint/typecheck/build in the loop so progress is measured in passing gates, not tokens spent. 