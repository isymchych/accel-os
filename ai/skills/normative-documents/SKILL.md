---
name: normative-documents
description:
  Preserve requirement integrity when creating or substantively revising specifications, policies,
  agent instructions, or other normative guidance. Use when edits could change obligations,
  permissions, scope, conditions, or exceptions, not for mechanical formatting or routine wording
  changes.
---

# Normative Documents

Treat normative documents as sources of truth for required or recommended behavior, constraints, and
decision rules.

Check the requirements affected by the edit; do not audit the whole document unless requested.
Routine wording changes need no formal comparison artifact or separate approval.

## Writing contract

- Write current rules at the level of the reader's decisions. State required behavior directly.
  Include conditions, exceptions, and rationale when they change how the rule is applied.
- Choose the shortest wording that preserves the complete requirement. Preserve normative meaning
  while freely replacing its presentation: consolidate repetition and convert historical
  explanations or implementation narratives into current rules.
- Use affirmative wording when it expresses the same requirement. Retain explicit prohibitions where
  they define permissions, safety boundaries, or constraints that positive wording would obscure or
  weaken.
- Include exact APIs, paths, commands, or implementation details when they define a required
  contract or clarify a constraint the reader needs.
- Cross-reference existing authority when the reader needs it to act, decide, or verify. Make clear
  what the reference supplies, and link to the relevant section when practical. Prefer that
  reference to duplicating requirements; omit links that merely signal related material.

For example, replace "Callers previously parsed responses independently, causing inconsistencies"
with "Validate and normalize external responses at the boundary" when that rule captures the
intended requirement.

## Requirement integrity

- Ground each statement presented as an established requirement or recommendation in an explicit
  request, an applicable authoritative requirement, or an accepted decision. Best practices,
  observed implementation behavior, and previously generated suggestions are not approval. Keep
  proposed additions distinct from agreed requirements; leave consequential gaps open for a decision
  rather than inventing obligations to complete the document.
- Treat requirement-level edits as behavior changes. Before proposing or applying replacement
  wording, compare the affected requirements with the proposed result. Check for additions and
  strengthening as well as omissions and weakening. Preserve their force, scope, conditions,
  exceptions, ordering constraints, and validation obligations unless changing them is explicitly
  authorized. Faithful restatement and routine wording choices do not require separate approval.
- Treat omission or weakening as removal. Ask before removing requirements beyond the user's
  explicit request.
- Check the edited scope and directly affected guidance for contradictions, missing decision
  guidance, and duplication. Reconcile materially affected requirements within the authorized scope;
  report blockers outside it. Comprehensive reviews require an explicit request.
- Report material requirement changes and unresolved conflicts. Keep preservation checks internal
  unless the user requests an audit.

## Final editing pass

Before finishing, check that the edited scope preserves intended requirements and contains no
unsupported obligations or unnecessary repetition.