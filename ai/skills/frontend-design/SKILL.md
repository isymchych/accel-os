---
name: frontend-design
description: Design and refine web interfaces with deliberate visual hierarchy, typography, layout, color, and interaction. Use when building or reshaping a page, component, or application UI, assessing its visual quality and usability, or reading, creating, or updating a visual DESIGN.md from project evidence or supplied references.
---

# Frontend Design

Fit the product before making it distinctive. Aim for a coherent, intentional
interface, not novelty for its own sake. A focused tool may need familiar,
compact controls; a public-facing page may benefit from a stronger visual voice.

## Scope and Authorization

Inspect and recommend by default. Implement only when the user has authorized
changes to the target. Invoking this skill does not itself authorize edits.
For a review-only request, follow the same workflow and stop at recommendations.

Own visual hierarchy, usability, aesthetic coherence, and rendered refinement.
Use `mobile-native` for mobile browser and touch-platform troubleshooting rather
than duplicating its diagnostic guidance here.

## DESIGN.md

A visual `DESIGN.md` records a product's design language: Markdown explains the
intent and application; optional YAML front matter defines exact design tokens.
Use it to carry a coherent visual direction across screens and design sessions.

1. **Read:** Find the applicable project `DESIGN.md` and read it alongside existing
   components and tokens. Establish its scope and how it guides the requested UI.
2. **Derive:** Inspect supplied screenshots, URLs, brand guidance, and source
   files. Extract hierarchy, typography, color roles, spacing, density, shapes,
   and component treatment. Record which references inform the direction and
   distinguish observed properties, estimates, and proposed choices.
3. **Write:** When authoring or updating a Google Labs format document, read
   [the vendored specification](references/design-md/spec.md) for syntax, section
   order, token rules, and examples. Resolve the path relative to this skill
   directory. Adapt references to the target product, describe actionable visual
   roles and relevant states, and map exact values to canonical project tokens.
   Include the sections that serve the project.
4. **Check:** Reconcile prose, token values, and implementation mappings, making
   material conflicts explicit. Check format compatibility against the vendored
   spec using an existing project validator when available. When implementation
   is in scope, compare representative rendered UI with the document using the
   inspection workflow below; report document and rendered checks separately.

## Workflow

### 1) Establish the Design Contract

- Identify the audience, primary task, content, and success criteria for the
  affected surface. Establish whether this is a new interface, extension, or
  redesign, and what should stay consistent.
- Start with project guidance, `DESIGN.md`, tokens, components, assets, and user
  references. Use existing visuals as evidence too. Preserve the design language
  unless redesign is requested; clarify gaps that materially change the result.
- Identify behavioral contracts to preserve, including routes, navigation, forms,
  analytics, and accessibility. A visual redesign does not authorize changing
  those contracts. For a review, use the same contract to assess the existing UI.

### 2) Resolve Consequential Choices

- Tie the direction to the product, content, brand requirements, and user
  preferences. Explain the choices that matter: information order, primary action,
  density, navigation, typography, and responsive behavior.
- When direction is genuinely vague, offer concrete alternatives and their
  tradeoffs. Adapt useful principles from references to the project's own content
  and tokens. State assumptions when references are unavailable.
- Use a wireframe or early viewable draft when it resolves material uncertainty.
  Include assumptions and placeholders, and use feedback before investing in
  detail. Routine work can proceed directly within the agreed direction.
- Read the relevant sections of
  [interface guidance](references/interface-guidance.md), relative to this skill
  directory, for composition, content, interaction, and accessibility decisions.

### 3) Implement Within the Existing System

- Reuse the project's stack, components, tokens, and approved assets. Introduce
  new values where the design needs them, keeping related screens and states
  consistent. Aesthetic novelty alone does not justify a dependency or new system.
- Use representative content and explicit placeholders. Adjust composition before
  adding content; ask before adding unrequested sections or product claims.
- Handle the states relevant to the changed flow. Apply the interface guidance
  for semantic controls, keyboard access, focus, feedback, motion, overflow, and
  loading behavior. Preserve existing state ownership and persistence contracts.

### 4) Verify the Contract

- Choose checks based on the change and the question being answered:
  - Token/component consistency: inspect source and computed styles.
  - Task completion and state transitions: exercise browser interactions.
  - Semantics and accessibility: inspect the DOM/accessibility tree, use keyboard
    checks and existing tooling, and use a screen reader where relevant and available.
  - Composition: inspect representative rendered views.
  - Established appearance regressions: use existing visual-regression checks.
- Inspect the actual rendered interface for visual changes when browser access is
  available. Use the cheapest evidence that answers the question. Capture
  screenshots for composition judgments, visual comparisons, or defects difficult
  to assess otherwise; reuse captures while they remain relevant.
- Match coverage to the change: a color-token change needs targeted theme and
  contrast checks, a layout change needs representative narrow/wide composition
  checks, and an interaction change primarily needs interaction and keyboard
  checks. Cover affected themes and states using the interface guidance.
- Batch relevant checks and fixes. Recheck affected areas after material changes
  or unresolved findings. Stop when the agreed requirements are met and observed
  regressions are resolved; further aesthetic exploration is a separate decision.
- Run focused project checks for changed code. Report inspected behavior, remaining
  defects, and verification gaps. If browser or device access is unavailable, use
  relevant existing visual fixtures after checking their target, theme, and
  freshness; distinguish those from current rendered checks. Source-only checks
  do not establish rendered quality, and screenshots or audits alone do not
  establish accessibility. Report blockers rather than polishing indefinitely.