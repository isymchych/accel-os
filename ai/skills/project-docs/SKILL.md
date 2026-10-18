---
name: project-docs
description:
  Organize, write, review, and maintain project documentation for small and medium projects. Use
  when choosing a docs layout, drafting behavioral specs or design proposals, recording ADRs,
  documenting architecture, or reconciling documentation with implementation.
---

# Project Docs

Keep a small, discoverable set of documents with clear responsibilities. Standardize what each
artifact means and how it stays useful, not how many documents a project must have.

## Scope and Authorization

Inspect and recommend by default. Create, edit, move, or retire documents only within explicit
authorization. Document approval does not authorize code changes, and implementation authorization
does not authorize unrelated documentation reorganization. Loading this skill adds no approval gates
to an authorized task.

Scale documentation to ambiguity, risk, and durability rather than elapsed time, file count, or a
mandatory development workflow. Clear, self-contained changes may need only acceptance criteria in
the conversation or existing issue. Include what the reader needs to act, decide, understand, or
verify; a topic's relevance alone does not justify a new section. For a small usage change, update
the affected instructions rather than adding a design discussion.

## Discover Before Organizing

1. Read repository guidance and locate the relevant docs, schemas, proposals, decisions,
   implementation, and checks. Use an existing index when available; load only the documents needed
   for the task.
2. Identify each document's audience, scope, authority, and lifecycle. Distinguish required
   behavior, observed behavior, and proposed behavior.
3. Respect an established layout or specification system. Do not create parallel sources of truth or
   migrate existing docs just to match the defaults below.
4. If authorities conflict, surface the discrepancy with evidence. Ask when the intended contract
   cannot be established; do not silently rewrite requirements to match code or treat an unapproved
   proposal as binding.

## Choose the Smallest Useful Artifact

| Artifact        | Owns                                                 | Use when                                                                                            |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Spec            | Required behavior and acceptance criteria            | A capability needs a durable, testable contract                                                     |
| Proposal/design | A candidate change, alternatives, and reasoning      | Consequential uncertainty or tradeoffs need resolution                                              |
| ADR             | A significant decision and its consequences          | The decision is hard to reverse, would surprise a future reader, and resolves credible alternatives |
| Architecture    | Current system structure and operational constraints | Readers need to understand responsibilities, dependencies, and flows                                |
| Domain model    | Business terminology, rules, and states              | Domain ambiguity affects behavior or naming                                                         |
| Guide           | How to accomplish a task                             | Users or developers need repeatable instructions                                                    |
| Runbook         | How to operate or recover a system                   | Operational actions and failure handling need durable instructions                                  |

Extend an existing artifact before adding another. A proposal can link to a spec for its behavioral
delta; an ADR can link to the proposal's alternatives. Do not copy full discussions or contracts
between them.

Use the related skills at their owning boundaries:

- `$ACCEL_OS/ai/skills/normative-documents/SKILL.md` for requirement-level writing and edits,
  including preservation of force, scope, exceptions, and validation.
- `$ACCEL_OS/ai/skills/planning/SKILL.md` for execution sequencing and verification plans. Keep
  plans in the project's established location or tracker.
- `$ACCEL_OS/ai/skills/domain-modeling/SKILL.md` for terminology and business rules.
- `$ACCEL_OS/ai/skills/architecture-review/SKILL.md` when evaluating structural quality, rather than
  duplicating its review workflow.
- `$ACCEL_OS/ai/skills/frontend-design/SKILL.md` for visual design guidance. Inspect a `DESIGN.md`
  document's purpose before classifying it.

## Default Layout

Use this vocabulary only where the project has no established equivalent. Create directories and
files on demand, not as empty scaffolding.

```text
README.md                         # Purpose, quick start, doc entry points
AGENTS.md                         # Agent instructions, commands, boundaries
docs/
  README.md                       # Navigation and document conventions
  architecture.md                 # Current system shape and constraints
  domain-model.md                 # Business terms, rules, states when useful
  specs/
    <capability>.md               # Living behavioral contract
  proposals/
    <change>.md                   # Change-oriented design discussion
  adr/
    0001-<decision>.md             # Significant decision history
  guides/
    <task>.md                     # User/developer how-to
  runbooks/
    <operation>.md                # Deploy, recover, migrate when needed
```

Use stable kebab-case names. Follow existing ADR numbering; for a new collection, use increasing
numbers and never renumber historical records. Split documents by cohesive capability or audience
when that makes them independently useful, not automatically by code module or development task.

Keep the index lightweight: document purpose, current entry points, and relevant relationships. If
multiple artifacts exist, explain which are maintained contracts and which are history. Keep
repository commands and agent permissions in their existing canonical guidance, not repeated in
every spec.

### Glossary Placement

Start with a Glossary section in `docs/domain-model.md`. Extract shared vocabulary to
`docs/glossary.md` when terms span multiple domains or audiences; keep domain-specific terms in
their owning domain document.

Give each concept one canonical definition. Other documents link to it rather than repeat it.
Include the precise meaning, ambiguous or deprecated synonyms when useful, and links to detailed
domain rules. A glossary defines vocabulary; it does not duplicate the domain model's relationships,
invariants, or workflows.

### Multilingual Glossaries

For multiple human languages, organize entries around concepts rather than independent word lists.
Choose the project's authoritative definition language and attach preferred terms in each supported
language to the same concept. Translate definitions only when the audience needs them; keep
translations aligned with the authoritative meaning.

Flag missing equivalents, ambiguous translations, and unresolved terminology rather than inventing
equivalence. Similar words can represent different legal or business concepts across languages; give
distinct meanings separate entries. Distinguish canonical domain terms from localized UI wording,
linking mappings only where useful.

Keep one shared glossary by default. Split into language-specific files only when size or separate
audiences justify the maintenance cost, using stable concept IDs to connect corresponding entries.
One authoritative meaning per concept allows multiple language expressions; it does not imply that
similarly translated words always name the same concept.

## Write for Decisions and Verification

Read [templates](references/templates.md) only for the artifact being authored. Start with the
answer the reader needs, not a list of possible sections. Use a title; add a purpose statement only
if the purpose is not already clear. Record status for proposals, ADRs, and draft specs using the
project's convention. Do not require a new metadata schema, knowledge protocol, or document
toolchain.

- Make required behavior observable and distinguish it from proposals, assumptions, and
  implementation details. Link canonical schemas and checks; do not duplicate them or invent quality
  targets.
- State boundaries, non-goals, failure behavior, or open questions when omitting them would cause a
  concrete misunderstanding or unsafe action.
- Explain architecture through the responsibilities and flows needed to understand the system. Add
  operational detail or a diagram only when it resolves a reader's question.
- For a consequential decision, explain the deciding tradeoff and credible alternatives, including
  no change when viable. Record operational ceilings or revisit conditions when they constrain the
  choice, not as routine sections.
- Keep verification and approval claims evidence-backed. Use requirement IDs or traceability tables
  only when ordinary links are insufficient.

Stop when the reader can use the artifact correctly. Do not add hypothetical concerns, investigation
chronology, or sections merely to complete a template.

## Maintain Contracts and History Separately

- **Specs:** capability-oriented living contracts. Label drafts explicitly; established specs
  describe the agreed target, not proof of implementation. Track material implementation gaps
  separately. Update requirements only for approved behavioral changes, preserving acceptance
  criteria and rationale.
- **Proposals:** change-oriented history. Use `draft`, `accepted`, `rejected`, `implemented`, or
  `withdrawn`. Acceptance records an approved direction, not implementation completion or permission
  to execute. Record the decision's evidence; mark implemented only when the agreed scope has been
  delivered and verified, noting any agreed exclusions.
- **ADRs:** use `proposed`, `accepted`, `rejected`, or `superseded`. Preserve the rationale of
  accepted decisions. A changed decision gets a new record with reciprocal supersession links;
  factual corrections may clarify the original without rewriting the historical choice.
- **Architecture/domain docs:** describe current supported reality and explicit constraints. Label
  planned changes and known gaps rather than blending them into the current-state description.
- **Guides/runbooks:** stay aligned with supported usage. State prerequisites, expected outcomes,
  relevant safety boundaries, and recovery where applicable.

When implementation is completed within the authorized scope, reconcile affected living docs and
index links, retain useful proposal history, and extract an ADR only when it independently meets the
decision criteria above. If reconciliation requires a new scope or unresolved contract change,
report it rather than editing.

## Check and Report

Before finishing:

- Check directly affected documents for contradictory requirements, duplicated authority, stale
  status, broken links, and unsupported claims.
- Trace important requirements to acceptance checks; distinguish actual check results from proposed
  tests or manual verification.
- Compare current-state descriptions with relevant implementation evidence. Keep unresolved
  discrepancies and assumptions visible.
- Use the project's existing formatter and documentation checks. Do not introduce tooling merely to
  validate this layout.
- Summarize material changes, checks performed, and remaining gaps without repeating the document.
  For normative changes, follow `normative-documents` reporting.

See [sources and adaptation](references/sources.md) for the influences and deliberately excluded
ceremony. They are background, not additional instructions.