---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea.
disable-model-invocation: true
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design
tree**: every decision branches into the decisions that hang off it.

Do not edit code, refactor, migrate, commit, stage, or otherwise change git state. Read, search,
inspect, and run clearly read-only diagnostics freely when useful. Ask before commands with unclear,
persistent, external, destructive, or environment-mutating effects.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already
settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the
whole frontier in one round: number each question and give your recommended answer. Then wait for
the user's answers before the next round.

Keep each round manageable: ask the smallest complete frontier, and split the round when the
frontier is too large to answer carefully.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree — settled decisions push the frontier outward and
unblock questions that depended on them. Recompute the frontier and ask the next round. A question
whose answer depends on another question still open in this round belongs to a _later_ round, not
this one.

Finding _facts_ is your job, never the user's. Use available read, search, and diagnostic tools to
answer factual questions yourself; ask the user only for decisions, preferences, or unavailable
context. Don't block on it: a running exploration is an unsettled prerequisite, so only the
questions downstream of it wait for the exploration to report — ask the rest of the frontier now.
The _decisions_ are the user's — put each to them and wait.

Recommend an answer only when evidence, constraints, or the user's stated preferences justify it.
Otherwise, state the trade-off and mark the recommendation as uncertain.

The session is done when the frontier is empty, or when remaining decisions are low-value or
implementation-local: every important branch of the design tree visited, nothing material left
silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

When done, summarize:

- settled decisions
- open risks
- recommended next action