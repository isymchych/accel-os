# Document Starting Points

Use only the relevant starting point and follow established project conventions.
These are not required section lists. Bracketed text is an authoring prompt;
replace it with useful content, not boilerplate. Extend an existing document
before creating another.
For unresolved questions, name the evidence or decision needed to resolve them.

## Behavioral Spec

Suggested path: `docs/specs/<capability>.md`.

```markdown
# [Capability]

Status: [draft or agreed]

[Required behavior for the intended consumer.]

[Observable acceptance outcome and link to its check, or proposed verification.]
```

Include boundaries, failure cases, and quality constraints when needed to define
the contract. Express quality constraints with agreed conditions and measurable
outcomes; do not invent targets. Link canonical schemas rather than copying them.
Identify unresolved requirements or implementation gaps when present;
distinguish proposed checks from completed verification.

## Change Proposal

Suggested path: `docs/proposals/<change>.md`.

```markdown
# [Proposed Change]

Status: draft

[Problem and evidence.]

[Proposed behavioral change, affected contract links, and the deciding tradeoff.]

[How to establish that the change solves the problem.]
```

Include credible alternatives for consequential choices. Add scope exclusions,
rollout, recovery, or open questions only when they affect the decision.
When resolved, record the actual decision and supporting approval evidence;
accepted does not mean implemented.

## Architecture Decision Record

Suggested path: `docs/adr/0001-<decision>.md`.

```markdown
# [Number]. [Decision]

Status: proposed

[Constraint or problem requiring a decision.]

[Chosen approach, why it wins over credible alternatives, and its consequences.]
```

Record the actual decision date and acceptance evidence when known. Link a
proposal's detailed comparisons instead of repeating them. When superseding a
decision, link both records.

## Current Architecture

Suggested path: `docs/architecture.md`.

```markdown
# Architecture

[System responsibilities and how its main parts interact.]

[Constraints needed to understand or safely change those interactions.]
```

Add data ownership, trust boundaries, runtime or failure paths, and diagrams
where they answer a concrete reader question. Describe supported reality;
label planned changes and known gaps rather than presenting them as implemented.

## Guides and Runbooks

A guide needs actionable steps and an expected result. State prerequisites the
reader cannot safely assume. Add troubleshooting for consequential failures,
not every conceivable error.

A runbook also needs its trigger, required access, safety checks for irreversible
actions, verification, and applicable recovery or escalation. Label unverified
commands; documentation permission does not authorize operational execution.

## Examples of Proportional Updates

- **Usage change:** replace an obsolete command and its changed prerequisite in
  the existing guide. No proposal or alternatives section is needed.
- **Policy clarification:** clarify the ambiguous condition in place, preserving
  its force and exceptions. Report the material clarification, not every
  unchanged requirement.
- **Consequential design decision:** record the constraint, choice, deciding
  tradeoff, and consequences. Link detailed contracts and verification instead
  of reproducing them.