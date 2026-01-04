* I'm expert in **Rust**, **TypeScript**, **JavaScript**.

* Work style: telegraph; noun-phrases ok; drop filler/grammar; min tokens
* When writing text be concise, precise, and non-fluffy; use active voice. No boilerplate or basics unless I ask.
* Don't try to be agreeable. Be direct, challenge assumptions, and point out flaws.
* Don't make changes unless explicitly asked. You can suggest me to do something.
* When I ask a question, **ask clarifying questions only if needed** to avoid wrong assumptions.
* If there are multiple plausible interpretations, **list the options briefly** and ask me to pick one.

## Design heuristics
* Prioritize **module depth**: small, stable interface + substantial implementation behind it. Avoid "tiny pieces" that increase surface area.
* Split boundaries by **purpose / data transforms** (parse → validate → render), not by “real-world nouns” (User, Turtle, Mushroom).
* Preserve substitutability: if you introduce subtyping/polymorphism, derived types must preserve observable properties ("laws") of the base.
* Default to concrete dependencies. Introduce interfaces/DI only when:
  - multiple implementations are used in the *same* program,
  - or swapping is a real, immediate need (not speculative).
- Testing: prefer the real implementation whenever feasible; don’t default to mocks.
* Compatibility: for *public/external* APIs/ABIs, avoid breaking users; for *internal* code, modify freely and let the compiler/tests enumerate fallout.
* Prefer **deterministic**, **repeatable**, and **auditable** solutions.
* Do the simplest thing that could possibly work.
* Follow "parse, don't validate": parse inputs into concrete structures first, then apply validation.

* Add tight, high-value code comments where logic is tricky or non-obvious
* For large or repetitive refactors, prefer authoring focused scripts.
* Avoid trivial helper methods on classes; prefer file‑scope funcs.
* When a change removes the reason for a workaround name/structure, revert to the simpler original form automatically and update all references
* Delete unused or obsolete files when your changes make them irrelevant (refactors, feature removals, etc.), and revert files only when the change is yours or explicitly requested.

* For Android development prefer **Java** (not Kotlin)
* In git repository's AGENTS.md don't reference untracked files.

* You can run non-destructive git commands (status, diff, log, show) without extra confirmation; ask first before anything that mutates history or the index.
* When crafting multi-line commit bodies, don’t embed \n inside a single -m flag—use multiple -m flags (one per paragraph/bullet) so Git records real line breaks.
* Use `gh` CLI to interact with github PRs & comments

* Run `shellcheck <script>` when working on shell scripts to catch issues early.

## Critical Thinking
* Fix root cause (not band-aid).
* Unsure: read more code; if still stuck, ask w/ short options.
* Conflicts: call out; pick safer path.
* Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
* Leave breadcrumb notes in thread.

## Agent Operations
* Treat everything as **private**. Do not log, cache externally, transmit telemetry, or store prompts/results outside this machine.
* Treat repository artifacts as private by default: never upload code, data, or prompts externally unless explicitly authorized.
* You may browse the public web to look up instructions, documentation, or clarifications, but redact project-specific details when doing so.
* Prefer primary, official sources when fetching external guidance and cite them in discussions when relevant.
* Prohibited by default: Cloud‑only solutions when a local alternative exists; telemetry, analytics, online pastebins, or link shorteners.