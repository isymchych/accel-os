---
name: agents-md
description:
  Author or review AGENTS.md files for decision-changing repository guidance, actionable commands,
  appropriate scope, and minimal duplication. Use when creating, auditing, or tightening repository
  instructions, not for routine coding tasks that merely require reading them.
---

# AGENTS.md

Make repository instructions a compact operational guide that prevents plausible but incorrect agent
actions. Optimize for better decisions, not documentation coverage or the shortest possible file.

Inspect and recommend by default. Create, edit, move, or remove instructions only within explicit
authorization. Permission to edit guidance does not authorize changing repository behavior, tooling,
or external systems.

## Establish the Relevant Evidence

Start with the requested area and reuse evidence already gathered. Read applicable instructions and
inspect the canonical commands, documentation, and implementation needed to understand the affected
guidance. Expand investigation only when a consequential uncertainty requires it; do not inventory
the whole repository by default.

Distinguish established requirements and explicit preferences from observed implementation and
proposed improvements. Existing code can establish how something works, but does not by itself
authorize a new rule. Keep unresolved consequential choices visible rather than filling gaps with
generic best practices.

When command accuracy matters, inspect the owning scripts or configuration. Run checks only when
safe and useful; do not execute provisioning, deployment, generation, or other state-changing
commands merely to verify their names.

## Select Guidance That Changes Decisions

For each candidate instruction, ask: **What plausible wrong action does this prevent, and would
removing it materially change an agent's decision?**

Keep guidance that earns its context, such as:

- Non-obvious ownership, dependency direction, or architectural constraints.
- Exact build, test, lint, and generation commands with their working directory when needed.
- Restricted operations, approval boundaries, generated files, and the supported alternative.
- Repository-specific conventions that cannot be safely inferred from nearby code.
- Validation expectations and completion conditions scoped to the affected kind of change.
- Load-bearing preferences, exceptions, and rationale that would otherwise be easy to reverse.

Leave obvious directory inventories, generic coding advice, and detailed architecture explanations
in their existing owners. Link canonical documentation when the agent needs it to act; do not add
links merely because the topic is related. Keep secrets and sensitive operational data out.

Treat Markdown instructions as guidance, not enforcement; stronger wording cannot guarantee
compliance. For hard boundaries, prefer appropriate permissions, sandboxing, or deterministic
checks. A hook's enforcement depends on its check and coverage; model-based hooks are not
deterministic merely because they run automatically.

Prefer existing tooling for mechanical enforcement. Do not remove an instruction merely because a
check exists: it may still explain how to avoid or recover from a failure. Propose tooling changes
separately when they exceed the authorized scope.

## Put Instructions at Their Owner

- Use the root file for repository-wide constraints and essential entry points.
- Use nested files for cohesive subsystem guidance when narrower loading materially helps; do not
  create one per directory by default.
- Keep general agent behavior in agent-level configuration, reusable procedures in skills, detailed
  explanations in repository documentation, and mechanical enforcement in tooling.
- Separate developer-local preferences from shared guidance when their audience differs. In a
  personal repository, committed personal preferences may be established project requirements; do
  not automatically move them into ignored or machine-local files.

Follow the repository's established instruction layout. Verify discovery and precedence for the
target agent when placement depends on them; do not assume all agents load nested files identically.
Avoid repeating global rules in local files or distributing one rule across multiple owners.

## Write Actionable Rules

State the required action, its conditions, and any exception that changes the decision. Include
exact paths or commands when they are necessary to act correctly. Pair restrictions with the
supported alternative when one exists.

Describe desired outcomes, constraints, and observable verification rather than prescribing effort
with phrases like "think harder" or aggressive emphasis. Preserve explicit prohibitions where they
define a real boundary.

For example, replace "Don't edit generated files" with:

> Files under `packages/client/generated/` come from `schemas/openapi.yaml`. Edit the schema and run
> `pnpm generate:client` from the repository root.

Use examples only when they clarify the rule; never copy illustrative paths or commands into a
repository as established facts.

Make validation proportional and concrete. Identify focused checks for local changes and broader
checks for shared contracts where the project requires them. Preserve existing validation
obligations; do not invent a mandatory full-suite run or weaken an established gate for efficiency.

For requirement-level edits, use `$ACCEL_OS/ai/skills/normative-documents/SKILL.md` to preserve
authority, force, scope, conditions, exceptions, and approval boundaries. Do not discard
unconventional preferences or safeguards merely to reduce length.

## Review and Report

Check the affected guidance for unsupported obligations, contradictions, duplication, stale
commands, and broken references. Confirm that consolidation preserves load-bearing meaning and that
a linked source supplies what the reader needs. Use the repository's existing formatting and
documentation checks.

Recommend additions when concrete mistakes, repeated corrections, or non-obvious constraints justify
them. Recommend removal when guidance is obsolete or redundant, while respecting authorization to
remove requirements. No change is a valid outcome.

Report the highest-value findings or completed changes, the decisions they improve, verification
performed, and material uncertainty. Distinguish expected benefits from measured results; do not
claim effectiveness from shorter text alone or require a benchmarking exercise for every edit.