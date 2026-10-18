---
name: normative-documents
description:
  Create or edit normative documents such as specifications, policies, plans, ADRs, AGENTS.md files,
  and other guidance that defines requirements or decision rules.
---

# Normative Documents

Treat normative documents as sources of truth for required or recommended behavior, constraints, and
decision rules.

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

- Treat requirement-level edits as behavior changes. Before proposing or applying replacement
  wording, compare the affected requirements with the proposed result. Preserve their force, scope,
  conditions, exceptions, ordering constraints, and validation obligations unless changing them is
  explicitly authorized.
- Treat omission or weakening as removal. Ask before removing requirements beyond the user's
  explicit request.
- Check the edited scope and directly affected guidance for contradictions, missing decision
  guidance, and duplication. Reconcile materially affected requirements within the authorized scope;
  report blockers outside it. Comprehensive reviews require an explicit request.
- Report material requirement changes and unresolved conflicts. Keep preservation checks internal
  unless the user requests an audit.

## Final editing pass

Check each sentence:

- What requirement or necessary decision context does it contribute?
- Can it state the desired behavior directly?
- Is its detail necessary for this document's reader?

Consolidate sentences that serve the same purpose.