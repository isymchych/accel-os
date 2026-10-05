---
name: explain-me
description: Explain the current topic or a specified target using prose, concrete examples, comparisons, or visuals. Use when the user asks for an explanation, walkthrough, mental model, or visual clarification of code, systems, processes, concepts, decisions, or plans.
disable-model-invocation: true
---

# Explain Me

Make the topic easier to understand. Choose the representation that answers the
user's question, not one that merely looks impressive.

Explanation only: keep files, git state, and external systems unchanged. Ask
before diagnostics with unclear or persistent side effects. Creating artifacts
or opening applications requires an explicit request.

## Establish The Question

- Reuse the current discussion, settled decisions, and evidence. Investigate
  only what is missing; do not restart discovery just to produce a new view.
- Identify what the user needs to understand and adapt to their audience and
  existing knowledge. For code, default to a maintainer's mental model.
- If the target is ambiguous, inspect what can be resolved locally. For code
  targets, prefer existing paths over git refs; if ambiguity remains, ask one
  concise clarification question before explaining.
- Explain what exists or is proposed, why it matters, and how the relevant
  pieces fit together. Include only the background needed for that question.

## Choose A Useful Representation

Use prose when it is clearest. Otherwise choose a focused view:

| Question                               | Useful view                                        |
| -------------------------------------- | -------------------------------------------------- |
| What is the central idea?              | Plain-language explanation with a concrete example |
| How do these things relate?            | Labeled relationship diagram                       |
| What happens, and in what order?       | Worked trace, timeline, or sequence diagram        |
| Who owns what, or how is it organized? | Responsibility map or shallow tree                 |
| What moves between components?         | Labeled data-flow diagram                          |
| Which transitions are allowed?         | State diagram or transition table                  |
| How do the options differ?             | Comparison table with consequential tradeoffs      |
| What changed?                          | Before/after view or structural diff               |
| How does the logic work?               | Worked example or pseudocode with concrete input   |

- Default to inline Markdown and small ASCII views for the terminal. Ask about
  format only when the choice materially affects usefulness.
- Explain how to read the view and the central takeaway. Label arrows so
  dependency, ownership, sequence, and data transfer are not conflated.
- Preserve consequential exceptions, boundaries, and assumptions. Simplify
  detail, not certainty; avoid duplicating the whole view in prose.
- Distinguish existing from proposed behavior, facts from inferred intent, and
  static relationships from observed execution. A call graph is not proof of
  runtime order; label inferred flows and observed traces accordingly.
- Label schematic diffs and pseudocode so sketches cannot be mistaken for
  verified patches or executable code.

## When Explaining Code

- For diffs and commits, resolve the exact change and include only necessary
  surrounding context. Distinguish changed behavior from pre-existing behavior.
- For files and subsystems, inspect enough surrounding code to identify relevant
  entrypoints, important types, callers, tests, ownership, and execution flow.
  Avoid exhaustive file-by-file summaries unless the target itself is small.
- For pasted snippets, explain only what is provided; do not assume missing
  surrounding context unless the snippet makes it clear.
- Cite paths and line numbers for code-specific claims. Quote only small snippets
  when needed, and explain important invariants, interfaces, lifecycle behavior,
  and failure handling when relevant to the question.

## Finish At Understanding

Lead with the useful mental model and organize the explanation around the
question, not a fixed section template. Mention obvious risks or surprising
choices when they arise naturally; do not turn explanation into a bug review or
search for every possible problem.

Stop when the question is clear. Point to useful tests, commands, logs, docs, or
next files when they help further exploration; do not turn the answer into a
full tutorial, implementation plan, or implementation unless requested.