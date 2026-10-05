---
name: frontend-design
description: Design and refine web interfaces with deliberate visual hierarchy, typography, layout, color, and interaction. Use when building or reshaping a page, component, or application UI, or when assessing its visual quality and usability.
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

## Workflow

### 1) Understand the Context

- Identify the audience, primary task, content, and success criteria. Establish
  whether the request is a new interface, an extension, or a redesign.
- Choose priorities for the surface, not the whole product: persuade visitors
  to decide and act; help users operate a tool; help readers understand; or let
  people experience the work itself. A product's landing page and settings screen
  need different emphasis. These priorities guide the same workflow.
- Inspect relevant screens, implementation, components, tokens, and assets.
  Distinguish verified behavior from assumptions and unavailable visual evidence.
- Treat existing visuals as evidence even without a design document. If the app
  cannot run, inspect available screenshot fixtures or visual-regression baselines;
  check their target, theme, and freshness against current code before relying on
  them. Report conflicts or stale captures rather than assuming they are current.
- Preserve the existing design language unless redesign is requested. Clarify
  missing information only when it would materially change the direction or scope.
- Identify behavioral contracts to preserve, including routes, navigation, forms,
  analytics, and accessibility. A visual redesign does not authorize changing
  product flows or those contracts.

### 2) Choose a Coherent Direction

- Tie visual decisions to the product and its content. Respect explicit brand
  requirements and user preferences before introducing a personal aesthetic.
- When the existing product offers insufficient direction, use user-supplied or
  relevant external references as evidence for hierarchy, density, navigation,
  and interaction. Adapt useful principles to the project's own content and tokens;
  do not copy another product's branding, proprietary assets, or exact layout.
  If references are unavailable, state assumptions rather than blocking routine work.
- For genuinely vague requests, offer concrete, meaningfully different directions
  and explain their tradeoffs instead of asking a generic taste questionnaire.
  Explore only what is needed to resolve the uncertainty.
- Briefly explain consequential choices in hierarchy, typography, spacing, color,
  density, and interaction. Use a wireframe when it resolves a layout question;
  do not require a separate design document or approval gate for routine changes.
- When substantial direction uncertainty remains, show an early viewable draft
  of the main composition, with assumptions and placeholders, before investing in
  complete states and detail. Use feedback to resolve the direction without making
  this a mandatory checkpoint for routine work.
- Make the primary action and information order clear. Use grouping, alignment,
  and whitespace to express relationships; reserve stronger emphasis for what
  matters most.
- For task-oriented interfaces, remove unnecessary interpretation before adding
  personality. Favor familiar affordances, consistent controls, restrained
  emphasis, and useful density. For reading, prioritize structure, navigation,
  and comfortable text; for persuasion, a clear action and credible evidence;
  for experiential surfaces, let the work lead and keep navigation understandable.
- Make relationships visible: related controls should read as a group, headings
  should belong clearly to the content they introduce, and separation between
  groups should be stronger than spacing within them. Evaluate these relationships
  with real content rather than imposing universal spacing or type values.
- Treat familiar patterns as options, not defaults or forbidden styles. Choose
  cards, gradients, decorative typography, or unusual layouts only when they
  serve the content and task. Remove decoration that competes with comprehension.
- Reuse existing tokens. Introduce new values only where the design needs them,
  keeping related screens and component states consistent.

### 3) Build Within the Requested Scope

- Reuse the project's stack, components, and assets. Aesthetic novelty alone does
  not justify a dependency, downloaded font, or replacement design system.
- Prefer representative content over generic filler. Label mock data and
  placeholders; do not invent testimonials, metrics, customer logos, or product
  capabilities as factual claims.
- Use supplied or approved logos, product imagery, and screenshots for branded
  work. Make missing assets explicit with honest placeholders rather than
  deceptive approximations.
- If the layout feels sparse, adjust composition, spacing, and typography before
  adding content. Ask before introducing unrequested sections or product claims.
- Use plain, specific labels that describe the user's action. Keep terminology
  consistent across controls, feedback, and navigation.
- Decide which filters, navigation, and selections should survive reloads or be
  shareable. Follow existing state-ownership conventions; change persistence or
  URL behavior only within the authorized scope, not through incidental refactoring.
- Cover applicable loading, empty, error, success, permission, disabled, and overflow states.
  Make failures actionable and preserve user input where recovery requires it.
- Empty states should explain the next useful action when one exists; errors
  should explain the problem and how to recover. Make state changes understandable
  without relying on animation alone.
- Keep semantic controls, keyboard access, visible focus, readable contrast, and
  accessible names part of the implementation. Respect reduced-motion preferences;
  use motion to clarify changes rather than delay access to content.
- Rapid interactions must safely replace or cancel earlier animations while
  preserving the final state, focus, and content. Correctness must not depend on
  an animation finishing or an animation-end event firing.
- Keep focus order logical; for modal dialogs, verify initial focus, containment,
  dismissal, and return to the invoking control. Associate field errors with their
  inputs and communicate state with text or other cues, not color alone.
- Design for the actual content and supported viewports: long labels, wrapping,
  dense data, and text resizing should not hide important information or actions.
- Prefer wrapping for chips, badges, and long identifiers. When truncation is
  necessary, make the full value available to keyboard, pointer, and touch users.
  Hidden collections need an operable disclosure, not just a static overflow count.
- Follow existing asset-loading conventions and reserve space for images and
  asynchronous content so loading does not displace important content or controls.

### 4) Inspect and Refine

- When browser access is available, inspect the actual rendered interface at
  representative narrow and wide widths. Use screenshots to evaluate hierarchy,
  spacing, alignment, readability, and visual consistency.
- Check each supported theme independently: secondary text, separators, interaction
  states, and overlays must remain understandable against their actual backgrounds.
  Do not infer dark-theme quality from light-theme checks or vice versa.
- Check loading-related layout jumps and interaction responsiveness in the relevant
  flows. Investigate observed problems rather than introducing speculative
  virtualization, loading infrastructure, or bundle refactors.
- Exercise the main interaction, keyboard navigation, and applicable states.
  Check focus order and visibility, contrast, and reduced-motion behavior with
  suitable inspection tools. Inspect screen-reader structure and announcements
  where relevant, using an actual screen reader when available. Use existing
  accessibility tooling and examine relevant console or runtime failures;
  screenshots and automated audits alone do not establish accessibility.
- Compare the result with the user's task and chosen direction. Correct unclear
  actions, inconsistent emphasis, layout failures, and distracting decoration
  within the authorized scope. Ask before expanding the work.
- Batch visual checks, fix material defects together, then confirm the corrections.
  Continue for unresolved requirements or regressions, not speculative aesthetic
  gains. Report blockers or remaining defects rather than polishing indefinitely.
- Run the project's focused checks for changed code. Report what was inspected
  and tested, remaining defects, and verification gaps. If browser or device
  access is unavailable, distinguish code-level checks from visual or hardware
  checks still needed; do not claim rendered quality from source inspection alone.