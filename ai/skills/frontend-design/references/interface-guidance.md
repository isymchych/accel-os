# Interface Guidance

Apply the sections relevant to the affected surface and flow. This reference
supports design and implementation decisions; the skill's workflow determines
the checks needed for a particular change.

## Composition

- Choose priorities for the surface, not the whole product: help visitors decide
  and act, help users operate a tool, help readers understand, or let people
  experience the work. A landing page and settings screen need different emphasis.
- Make the primary action and information order clear. Use grouping, alignment,
  and whitespace to express relationships; reserve stronger emphasis for what
  matters most.
- For task-oriented interfaces, remove unnecessary interpretation before adding
  personality. Favor familiar affordances, consistent controls, restrained
  emphasis, and useful density. For reading, prioritize structure, navigation,
  and comfortable text; for persuasion, a clear action and credible evidence;
  for experiential surfaces, let the work lead and keep navigation understandable.
- Related controls should read as a group, headings should belong to the content
  they introduce, and separation between groups should exceed spacing within
  them. Evaluate relationships with real content rather than universal values.
- Treat familiar patterns as options. Choose cards, gradients, decorative
  typography, or unusual layouts when they serve the content and task. Remove
  decoration that competes with comprehension.
- Adapt principles from references to the project; do not copy another product's
  branding, proprietary assets, or exact layout.

## Content and Assets

- Prefer representative content over generic filler. Label mock data and
  placeholders; do not invent testimonials, metrics, customer logos, or product
  capabilities as factual claims.
- Use supplied or approved logos, product imagery, and screenshots for branded
  work. Make missing assets explicit with honest placeholders.
- Use plain, specific labels describing the user's action. Keep terminology
  consistent across controls, feedback, and navigation.
- Follow existing asset-loading conventions and reserve space for images and
  asynchronous content so loading does not displace content or controls.

## Interaction and State

- Decide which filters, navigation, and selections should survive reloads or be
  shareable. Follow existing state-ownership conventions; change persistence or
  URL behavior only within the authorized scope.
- Cover applicable loading, empty, error, success, permission, disabled, and
  overflow states. Make failures actionable and preserve user input for recovery.
- Empty states should explain the next useful action when one exists; errors
  should explain the problem and how to recover. Make state changes understandable
  without relying on animation alone.
- Use motion to clarify changes rather than delay access to content. Rapid
  interactions must safely replace or cancel earlier animations while preserving
  final state, focus, and content. Correctness must not depend on animation
  completion or an animation-end event.

## Accessibility and Content Resilience

- Keep semantic controls, keyboard access, visible focus, readable contrast, and
  accessible names part of the implementation. Respect reduced-motion preferences.
- Keep focus order logical. For modal dialogs, verify initial focus, containment,
  dismissal, and return to the invoking control. Associate field errors with inputs
  and communicate state with text or other cues, not color alone.
- Design for actual content and supported viewports: long labels, dense data,
  wrapping, and text resizing should leave important information and actions usable.
- Prefer wrapping for chips, badges, and long identifiers. When truncation is
  necessary, make the full value available to keyboard, pointer, and touch users.
  Hidden collections need an operable disclosure, not a static overflow count.
- For affected themes, check secondary text, separators, interaction states, and
  overlays against their actual backgrounds. Check each supported theme
  independently rather than inferring one theme's quality from another.
- Check relevant loading-related layout jumps and interaction responsiveness.
  Investigate observed problems rather than adding speculative virtualization,
  loading infrastructure, or bundle refactors.
- Check focus order and visibility, contrast, and reduced-motion behavior with
  suitable inspection tools. Inspect screen-reader structure and announcements
  where relevant, using an actual screen reader when available. Use existing
  accessibility tooling and examine relevant console or runtime failures.