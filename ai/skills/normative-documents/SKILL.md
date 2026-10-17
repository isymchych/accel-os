---
name: normative-documents
description: Create or edit normative documents such as specifications, policies, plans, ADRs, AGENTS.md files, and other guidance that defines requirements or decision rules.
---

# Normative Documents

Treat normative documents as sources of truth for required or recommended
behavior, constraints, and decision rules.

- Treat requirement-level edits as behavior changes.
- Write durable domain rules and current required behavior. Include implementation
  details or historical rationale only when they clarify a concrete constraint
  the reader needs.
- Preserve distinct requirements, not their wording or repeated explanations.
  Add text only when it changes what the intended reader needs to do, decide,
  understand, or verify. Link existing authority instead of restating it.
- Prefer an affirmative rule when it expresses the same requirement. Retain
  explicit prohibitions where they define permissions, safety boundaries, or
  other constraints that positive wording would obscure or weaken.
- Keep the edited scope and directly affected guidance internally consistent.
- Before proposing or applying replacement wording, compare the affected
  requirements with the proposed result. This is an editing check, not a required
  document section or user-facing inventory.
- Preserve each requirement's force, scope, conditions, exceptions, ordering
  constraints, and validation obligations unless changing it is explicitly
  authorized.
- Treat an omitted or weakened requirement as a removal, even when its
  surrounding section or bullet remains.
- Check the directly affected scope for contradictions, missing decision
  guidance, and duplicated rules. Do not expand into a comprehensive review
  unless requested.
- Reconcile materially affected requirements in the same document or directly
  related governing documents. Report blockers when reconciliation is outside
  the authorized scope.
- Report material requirement changes and unresolved conflicts. Enumerate
  preserved requirements only when an audit is requested.
- Ask before removing requirements beyond the user's explicit request.