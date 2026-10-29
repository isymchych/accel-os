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

Proposed visual direction, to be refined through representative screens. Adopting it requires a
separately authorized UI change; mentioning a component or behavior here does not add it to scope.

A quiet reading room with a well-organized workbench: warm, literate, precise, and calm. Reading
feels inviting; controls feel direct. Clarity wins over atmosphere.

## Reference and ownership

Inspired by
[Earendil's website source](https://github.com/earendil-works/website/tree/3bbe3f2b0a50df2dd2f68ea76f1e3743b80eb375),
especially `_static/styles.css`, its fonts, and `_static/script.js`: serif/mono typography,
day/night neutrals, spacious framing, dotted links, and a grain-treated ocean scene.

This is an adaptation, not a copy of its identity or layout. The front matter proposes local
baseline values, including system fonts, supporting colors, compact framing, and component
treatments. No reference fonts, logos, textures, or shader assets are adopted.

`client/styles/theme.css` owns runtime tokens and Tailwind mappings; shared styles reference those
tokens. `client/ui/` owns domain-free primitives; features own content and state.

### Interaction references

Use [assistant-ui](https://github.com/assistant-ui/assistant-ui) and
[TanStack AI UI](https://tanstack.com/ai/latest/docs/ui/react) as conversation UX references when
designing streaming, composer behavior, tool disclosures, message actions, and error/reconnect
feedback. Borrow patterns where they fit the workspace; do not adopt their visual identity or assume
a conventional chat layout.

These are interaction references, not selected UI dependencies or additions to feature scope.
[ARCHITECTURE.md](ARCHITECTURE.md#frontend-design) owns the Solid 2 and TanStack client integration.

## Colors

Use warm neutrals. Establish emphasis through contrast, typography, and placement before color.

| Role              | Light / dark tokens                           | Use                            |
| ----------------- | --------------------------------------------- | ------------------------------ |
| Canvas            | `background` / `night-background`             | Main surface                   |
| Ink               | `foreground` / `night-foreground`             | Text and icons                 |
| Secondary surface | `surface` / `night-surface`                   | Controls, menus, code          |
| Secondary ink     | `muted-foreground` / `night-muted-foreground` | Supporting text                |
| Separator         | `border` / `night-border`                     | Nonessential dividers          |
| Control edge      | `control-border` / `night-control-border`     | Required boundaries            |
| Danger            | `destructive` / `night-destructive`           | Destructive actions and errors |

Map the active palette to existing semantic tokens such as `--background`, `--foreground`,
`--primary`, `--primary-foreground`, `--muted-foreground`, `--border`, `--input`, `--destructive`,
and `--ring`. These light/night pairs are not another theme system. Default to the system
preference.

Primary actions use ink with canvas-colored text, inverted in dark mode. Hover and pressed states
strengthen borders or underlines without shifting layout. Selection combines a secondary surface
with an explicit marker, not a faint wash alone.

Status uses clear text, optionally reinforced by an icon and color. Color alone must not distinguish
execution from connection.

## Typography

Serif reading and technical monospace are the signature:

- **Prose:** serif, starting at 18px/1.6. Paths, commands, and inline code remain monospace.
- **Headings:** upright serif, usually 28px/1.2; 22px for subsections. Use italics sparingly, not as
  the default for operational text.
- **Controls:** monospace, 15px/1.4; prefer sentence case. Uppercase is for short, nonessential
  overlines.
- **Metadata:** monospace, 13px/1.4. Keep essential status and actions out of this role.
- **Code:** monospace, 14px/1.5. Preserve indentation and selection; scroll long blocks horizontally
  within their container, not the page.

Start with the front matter's system stacks. Plantin and Departure Mono are references, not
dependencies. Custom fonts need separate approval, appropriate licensing, and rendered readability
checks.

Use weight 400 normally and 700 for emphasis. Keep semantic heading order independent of size.
Centralize type roles in `theme.css`, retaining compatible primitive mappings.

## Layout and shape

Reading areas use a centered column, normally 65-75 characters wide, and generous paragraph rhythm;
surrounding panels need not share that width. Working areas use compact, aligned controls: 8-16px
within groups, 24-32px between groups.

Use Tailwind's spacing scale; the reference values do not require utility aliases. Centralize shared
control/icon sizes. Start with 16px outer gutters on narrow views and 32px on wide ones.

Let content width determine columns. Narrow views stack or disclose secondary panels while keeping
the task, essential state, and primary action reachable. Prefer document flow; sticky controls must
leave room for inputs and long output. Wrap identifiers where practical and keep full values
available when truncating.

Separate flat surfaces with tone, spacing, and fine rules; use mostly straight edges with 4px
corners on controls and overlays. Avoid a floating card for every message; popovers and dialogs may
use one restrained shadow to clarify overlap. Reserve circles for naturally circular icons or
avatars; pills are not the default control shape. Vary shape to communicate roles, not to decorate.

Optional texture stays static, subtle, and beneath opaque reading/control surfaces; the interface
remains complete without it. Ocean animation, grain, and stars are not baseline requirements.
Atmospheric backgrounds belong on experiential surfaces, not behind sustained reading or operational
panels.

Use immediate updates and scrolling by default, with minimal local motion only for essential
interaction clarity. Controls stay responsive.

## Components

### Navigation and actions

Use clear navigation labels and a persistent current-location marker. Reading links have dotted
underlines at rest and solid underlines on hover; ornamental stars are optional.

Give each task group one dominant action. Primary buttons use inverse ink/canvas; secondary buttons
use visible outlines; tertiary actions remain recognizable controls.

Fields need explicit labels, opaque surfaces, and control-edge borders. Placeholders supplement
labels. Associate help and errors with the field; preserve input through recoverable failures.

Document each primitive's label, event, and controlled-state ownership. Cover applicable loading,
empty, error, disabled, permission, success, and overflow states.

### Reading and activity

Distinguish author, prose, code, and tool metadata through hierarchy, not a colored bubble for every
message. Keep tool summaries compact and details in operable disclosures; keep failure-critical
information visible.

Show [execution, outcomes, and connection](DOMAIN.md#activity-outcomes-and-connection)
independently. Badges reflect domain state rather than inventing it. Streaming preserves reading
position and active input.

### Feedback and overlays

Empty states suggest the next useful action; errors explain the problem and recovery. Loading
preserves layout and never masquerades as confirmed results. Disabled controls remain readable and
explain why when unclear.

Use shared overlay primitives with clear triggers and straightforward dismissal. Lucide icons have
consistent sizes, strokes, semantic foregrounds, and meanings; size interactive targets separately.
Tooltips supplement visible controls. Unfamiliar or consequential actions need visible text.

## Refinement

Before adopting the direction, compare representative prose, code, and settings in both themes,
narrow/wide layouts, and long content. Check core workflows as well as hierarchy; token checks alone
do not establish usability.

Resolve serif suitability for long responses, monospace legibility, working density, and whether
texture helps. Record approved adjustments here and reconcile runtime values in `theme.css`, without
changing unrelated architecture decisions.