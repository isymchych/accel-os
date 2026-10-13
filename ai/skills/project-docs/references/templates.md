# Document Templates

Use only the relevant template. Bracketed text is an authoring prompt, not content
to retain. Follow established project formatting and status conventions. Omit
sections with no useful content rather than filling them with boilerplate.

## Behavioral Spec

Suggested path: `docs/specs/<capability>.md`.

```markdown
# [Capability]

Status: [draft or agreed; record actual approval evidence when needed]

[Brief purpose and intended consumers.]

## Scope

[Included behavior and explicit non-goals.]

## Required Behavior

[Rules and invariants in domain language. Include meaningful examples,
states/transitions, and alternate or failure cases.]

## Boundary Contracts

[Inputs, outputs, ownership, side effects, authorization, and error behavior
where relevant. Link canonical schemas instead of copying them.]

## Quality Constraints

[Relevant security, performance, reliability, compatibility, or operational
requirements with agreed conditions and measurable outcomes.]

## Acceptance and Verification

| Required outcome                            | Verification                                      |
| ------------------------------------------- | ------------------------------------------------- |
| [Observable result under stated conditions] | [Test/check/manual procedure and expected result] |

[Link existing checks. Distinguish proposed checks from completed verification.]

## Open Questions and Implementation Gaps

[Unresolved requirements, assumptions, and known target-versus-current gaps.
Name the evidence or decision needed; do not present guesses as requirements.]

## Related Documents

[Links to relevant domain rules, proposals, decisions, and interfaces.]
```

## Change Proposal

Suggested path: `docs/proposals/<change>.md`.

```markdown
# [Proposed Change]

Status: draft

[Brief purpose.]

## Problem and Evidence

[Who is affected, what is wrong, supporting evidence, and desired outcome.]

## Scope and Behavioral Delta

[What changes and what stays unchanged. Link existing specs and identify
proposed contract changes. Include non-goals.]

## Proposed Design

[Responsibilities, data ownership, dependencies, interfaces, and representative
flows. Include failure behavior and a diagram where useful.]

## Alternatives and Tradeoffs

[Credible alternatives, including doing nothing. Explain the recommended
choice, costs, risks, and the evidence that would change the recommendation.]

## Delivery and Validation

[Compatibility, migration, rollout/rollback when relevant, and checks that
establish success. Link a separate execution plan only if one is useful.]

## Open Questions

[Unresolved assumptions and decisions that materially affect the direction.]

## Resolution

[Fill when resolved: actual decision and approval evidence, agreed changes
or exclusions, and links to updated living docs and verification.
Accepted is not implemented.]
```

## Architecture Decision Record

Suggested path: `docs/adr/0001-<decision>.md`.

```markdown
# [Number]. [Decision]

Status: proposed

[Date of actual decision and evidence of acceptance when known.]

## Context

[Forces, constraints, evidence, and the tradeoff requiring a decision.]

## Decision

[One clear choice, its scope, and why it was chosen.]

## Alternatives

[Credible options and why they were not chosen; link the proposal for detail.]

## Consequences

[Benefits, costs, operational limits, and follow-up obligations.
State what would justify revisiting the decision.]

## Related Records

[Related proposal/spec/architecture links. When superseding a decision,
link its ADR and update the old record to point here.]
```

## Current Architecture

Suggested path: `docs/architecture.md`.

```markdown
# Architecture

[Purpose, scope, and evidence of the supported current system.]

## Context and Constraints

[Users, external systems, significant boundaries, and constraints.
Link authoritative quality requirements and domain rules.]

## Responsibilities and Dependencies

[Major building blocks, what each owns, and dependency direction.
Use a context/container/component view only at useful zoom levels.]

## Data and Trust Boundaries

[State ownership, external inputs, validation, persistence, and lifecycle.]

## Runtime and Failure Paths

[Representative interactions and important failures.
Add deployment/recovery detail only where needed to understand operation.]

## Risks and Known Gaps

[Evidence-backed limitations; label planned changes separately from reality.
Link proposals rather than presenting their designs as implemented.]

## Decisions and Further Reading

[Links to significant ADRs, specs, domain docs, guides, and runbooks.]
```

## Guides and Runbooks

For a guide, describe the task, audience, prerequisites, steps, and expected
result. Include troubleshooting for consequential failures.

For a runbook, also state when to use it, required access, safety checks before
irreversible actions, operational verification, and recovery/escalation when
applicable. Label unverified commands; documentation permission is not permission
to execute operational actions.