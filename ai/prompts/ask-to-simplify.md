---
description: See if there are opportunities to simplify code
---

I'd like to know if we can simplify & clean up code: **$ARGUMENTS**.

Review only; do not edit files. If no target is supplied, review the current
task's changes. If that scope is unclear, ask before proceeding.

Focus on:

- the simplest coherent design within scope; use diff size as a tie-breaker
- code that can be deleted
- standard-library or platform features that can replace custom code or dependencies
- abstractions that may not be earning their keep
- invariants that should be explicit or tested
- coupling points introduced or worsened
- module cohesion lowered by the change
- cognitive load for the next maintainer
- cleverness that can be avoided

Do not conduct a general correctness review, but check that each proposed
simplification preserves behavior, including errors, side effects, ordering,
and edge cases. Do not recommend removing guards, tests, or constraints without
understanding the intent they protect.

Preserve abstractions that name meaningful concepts or isolate responsibilities.
A single caller is a reason to investigate, not proof that an abstraction is
unnecessary; evaluate the resulting caller and module together.

Follow project conventions. Recommend changes that reduce reasoning effort,
not merely express a stylistic preference.

Output:

List findings by net maintenance benefit, from high to low, accounting for
migration cost, regression risk, and review burden. Make each finding easy to scan:

- a short descriptive heading
- the relevant `file:line`
- why the current code is unnecessarily complex
- the concrete simplification
- brief evidence from relevant callers, entry points, configuration, tests, or
  documented contracts; caller counts alone do not establish that code is dead
- why behavior remains equivalent, any uncertainty or focused verification
  needed, and material tradeoffs

Use these tags only when they make a finding clearer:

- `delete`: dead code, unused flexibility, or speculative functionality
- `stdlib`: custom code replaceable by the standard library
- `native`: a dependency or custom code replaceable by the platform
- `yagni`: an abstraction, option, or layer unsupported by current needs
- `shrink`: the same behavior expressed more directly
- `cohesion`: misplaced responsibility or a fragmented module
- `invariant`: a rule that can replace defensive states or branching

Do not optimize for line count; optimize for fewer concepts, states,
dependencies, and coupling points.

Do not manufacture findings. If none are worthwhile, say:
`No worthwhile simplifications found.`