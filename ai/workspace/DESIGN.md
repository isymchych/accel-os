---
version: alpha
name: Quiet Workshop
description: Warm editorial minimalism with precise, understated technical controls.
colors:
  primary: "#353431"
  background: "#FAF9F6"
  foreground: "#353431"
  surface: "#F2EFE8"
  muted-foreground: "#6B6860"
  border: "#C7C2B8"
  control-border: "#827D73"
  destructive: "#A33A32"
  night-background: "#2E2D2B"
  night-foreground: "#F4F2EE"
  night-surface: "#383632"
  night-muted-foreground: "#B8B4AC"
  night-border: "#5C5850"
  night-control-border: "#8E887D"
  night-destructive: "#F09A90"
typography:
  reading:
    fontFamily: "Georgia, Cambria, Times New Roman, serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  heading:
    fontFamily: "Georgia, Cambria, Times New Roman, serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.2
  ui:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.4
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  frame-narrow: 16px
  frame-wide: 32px
rounded:
  none: 0px
  sm: 4px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
  button-primary-night:
    backgroundColor: "{colors.night-foreground}"
    textColor: "{colors.night-background}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
---

# Quiet Workshop

## Overview

**Status: proposed visual direction, not the current rendered interface.**
This is a reusable starting point for the AI workspace, intended to evolve through
representative screens rather than prescribe a finished product.

The character is a quiet reading room with a well-organized workbench: warm,
literate, precise, and calm. Reading should feel inviting; operating the tool
should feel direct. Prefer clarity over atmosphere whenever they compete.

Inspired by [Earendil's website source](https://github.com/earendil-works/website/tree/3bbe3f2b0a50df2dd2f68ea76f1e3743b80eb375),
especially `_static/styles.css`, its font definitions, and `_static/script.js`.
The observed reference combines serif/mono typography, neutral day/night themes,
spacious framing, dotted links, and a grain-treated ocean scene. This guide
adapts those principles; it does not reproduce Earendil's identity or layout.

The front matter defines proposed baseline values. System font substitutions,
the palette's supporting colors, compact framing, and component treatments are
local design choices, not extracted Earendil tokens. No reference fonts, logos,
textures, or shader assets are adopted.

### Scope and ownership

- This document guides visual choices; [ARCHITECTURE.md](ARCHITECTURE.md) remains
  authoritative for behavior, accessibility, and ownership.
- `client/styles/theme.css` owns runtime tokens and Tailwind mappings.
  `client/ui/` owns domain-free primitives; features own content and state.
- The current UI uses Inter/system sans, cooler blue-accented themes, and a
  10px base radius. These proposed warm colors, serif/mono roles, and 4px radius
  are not implemented. Apply them only in a separately authorized UI change.
- When implementing, reconcile this baseline with the canonical CSS tokens.
  Do not maintain competing token definitions in feature styles.

## Colors

Use warm neutrals for the main interface. Contrast, typography, and placement
provide emphasis before color does.

| Role              | Light token        | Dark token               | Application                            |
| ----------------- | ------------------ | ------------------------ | -------------------------------------- |
| Canvas            | `background`       | `night-background`       | Main working surface                   |
| Main ink          | `foreground`       | `night-foreground`       | Reading, labels, icons                 |
| Secondary surface | `surface`          | `night-surface`          | Grouped controls, menus, code          |
| Secondary ink     | `muted-foreground` | `night-muted-foreground` | Supporting text and metadata           |
| Separator         | `border`           | `night-border`           | Nonessential dividers                  |
| Control edge      | `control-border`   | `night-control-border`   | Required input/control boundaries      |
| Danger            | `destructive`      | `night-destructive`      | Destructive actions and error feedback |

The primary action is ink-filled with canvas-colored text; invert those roles
in dark mode. Hover and pressed states strengthen the border or underline
without changing layout. Selection uses a secondary surface plus an explicit
marker, not a faint color wash alone.

Map the active theme to existing semantic names such as `--background`,
`--foreground`, `--primary`, `--primary-foreground`, `--muted-foreground`,
`--border`, `--input`, `--destructive`, and `--ring`. Use main ink for
focus rings. The light/night names here describe palette pairs, not a second
runtime theming mechanism.

Default to system theme preference. Any future explicit override follows the
application-preference ownership in the architecture.

Status is text-first: pair a clear label with an icon where helpful. Color may
reinforce status but never distinguish execution from connection on its own.

## Typography

The contrast between literary reading and technical operation is the signature.

- **Reading:** serif for conversation prose and explanatory content, starting at
  18px/1.6. Keep paths, commands, and inline code monospace.
- **Headings:** upright serif, usually 28px/1.2; use 22px for subsection headings.
  Italics are occasional editorial emphasis, not the default for operational text.
- **UI:** monospace at 15px/1.4 for navigation, buttons, fields, and concise labels.
  Prefer sentence case. Reserve uppercase for short, nonessential overlines.
- **Metadata:** monospace at 13px/1.4; do not shrink essential status or actions
  into this role.
- **Code:** monospace at 14px/1.5. Preserve indentation and selection. Use localized
  horizontal scrolling for preformatted content rather than page overflow.

Start with the system stacks in the front matter. Earendil's Plantin and
Departure Mono are references, not font dependencies. A custom face requires
separate approval, appropriate licensing, and rendered readability checks.

Use weight 400 for the baseline and 700 for explicit emphasis. Maintain semantic
heading order independently of visual size. Keep type roles centralized in
`theme.css`, retaining compatible primitive font mappings.

## Layout

Use two complementary densities:

- **Reading areas:** a centered column, normally 65-75 characters wide, with
  generous paragraph rhythm. Constrain prose, not every surrounding panel.
- **Working areas:** compact, aligned navigation, settings, and activity lists.
  Group related controls with 8-16px gaps; separate groups with 24-32px.

Use Tailwind's existing spacing scale. The front matter records recurring
reference steps, not a requirement to alias every utility. Begin with 16px
outer gutters on narrow views and 32px on wide views.

Let available content width determine column changes rather than copying
Earendil's viewport-edge chrome. Narrow layouts stack or disclose secondary
panels while keeping the current task and primary action reachable. Do not
hide essential state merely to preserve whitespace.

Prefer document flow. Sticky controls must leave room for focused elements,
zoomed text, and long output. Wrap identifiers where practical; keep full values
available when truncation is necessary.

## Elevation & Depth

Separate layers with tone, spacing, and fine rules. Avoid turning each message
or section into a floating card. Popovers and dialogs may use one restrained
shadow when it clarifies overlap; ordinary content stays flat.

Texture is optional. If introduced, keep it static, subtle, and beneath opaque
reading/control surfaces. The interface must remain complete without it.

Ocean animation, film grain, and star ornament are not baseline requirements.
An atmospheric background belongs only on a deliberately experiential surface,
not behind sustained reading or operational panels.

Use 120-200ms transitions for local hover, disclosure, and appearance changes.
Respect reduced motion; do not delay access or depend on animation completion.
Do not animate arriving text or pulse the entire working surface.

## Shapes

Use mostly straight edges with a small 4px radius for controls and overlays.
Hairline dividers and modest corners should feel precise, not severe.

Reserve circular shapes for naturally circular icons or avatars. Avoid
pill-shaped controls as the default. Shape variation should communicate a
different role rather than decorate a component.

## Components

These are usage contracts for needed components, not permission to scaffold
unimplemented features.

### Navigation and links

Navigation uses clear text labels and a persistent current-location marker.
Reading links use a dotted underline at rest and a solid underline on hover or
keyboard focus. Focus also retains a visible ring; underlines alone do not
replace it. Ornamental stars are optional and must not carry meaning.

### Actions and fields

Keep one clearly dominant action per task group. Primary buttons use the
inverse ink/canvas treatment; secondary buttons use a visible outline; tertiary
actions remain recognizable as controls.

Use explicit field labels, opaque surfaces, and the control-edge color.
Placeholder text supplements labels rather than replaces them. Associate errors
and help text with their fields. Preserve input during recoverable failures.

### Reading and activity

Distinguish author, prose, code, and tool metadata through hierarchy rather than
a separate colored bubble for every message. Tool summaries are compact; detailed
output uses an operable disclosure. Do not collapse information necessary to
understand a failure.

Show execution activity and browser connection separately, following the
architecture's state contracts. Disconnected information is last observed,
not proof that execution stopped. Do not invent product state to fit a visual
badge.

### Feedback and overlays

Empty states give the next useful action; errors explain the problem and recovery.
Loading feedback preserves layout and does not masquerade as confirmed results.
Disabled controls remain readable and communicate why when the reason is unclear.

Use existing semantic primitives for menus and dialogs. Ensure accessible names,
logical focus order, keyboard operation, dismissal, and focus return. Decorative
Lucide icons are hidden from assistive technology; icon-only controls have names.

## Do's and Don'ts

- Do preserve serif reading, technical monospace, warm neutrals, and restrained
  emphasis as the core identity.
- Do adapt density to the task instead of imposing a landing-page composition.
- Do retain familiar controls and visible affordances.
- Do check both themes, narrow/wide layouts, long content, and text resizing.
- Do verify text contrast of at least 4.5:1 for ordinary text and 3:1 for large
  text; essential control boundaries and focus indicators need 3:1 against
  adjacent surfaces. Check actual states and backgrounds, not palette swatches alone.
- Do validate keyboard flows and reduced motion alongside rendered hierarchy.
- Don't copy Earendil's brand assets or make decorative effects prerequisites.
- Don't introduce fonts, components, theme persistence, or product behavior solely
  because this guide mentions them.
- Don't treat a token/document check as proof of rendered usability.

### Refinement checkpoints

Before adopting this direction, compare representative reading, code, and
settings content in both themes. Resolve serif suitability for long responses,
monospace legibility in controls, operational density, and whether texture adds
value. Record approved adjustments here and reconcile implemented values with
`theme.css`; leave unrelated architecture decisions unchanged.