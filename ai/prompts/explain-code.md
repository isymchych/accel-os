---
description: Explain a diff, commit, file, folder, project area, or pasted code for a maintainer
argument-hint: "<diff, commit/range, file, folder, project area, or pasted code>"
---

Explain this code target for a maintainer: **$ARGUMENTS**.

The target may be a git diff, commit/range, file path, folder path, project area, or pasted code.

First classify the target:

- **Diff target**: git refs, commit ranges, or flags such as `--staged`, `--unstaged`, and `--working-tree`.
- **File target**: one or more existing files.
- **Folder/project target**: a directory, module, package, or named subsystem.
- **Snippet target**: pasted code.

If ambiguous, prefer existing paths over git refs. If still ambiguous, ask one concise clarification question before explaining.

Your goal is to give a maintainer a useful mental model of the code or change.
Explain what exists, what changed, why it matters, and how the pieces fit together.

Do not perform a bug review. Mention obvious correctness, design, or maintainability problems only when they naturally arise from understanding the target.

For diff targets:

- Resolve the exact diff.
- Explain only the change plus necessary surrounding context.
- Clearly distinguish changed behavior from pre-existing behavior.
- Explain the intent you can infer from the change, but label inference as inference.

For file/folder/project targets:

- Explain the current design, ownership, boundaries, and execution flow.
- Explore enough surrounding code to identify relevant entrypoints, important types, callers, and tests.
- Avoid exhaustive file-by-file summaries unless the target itself is small.

For snippet targets:

- Explain only the provided code.
- Do not assume missing surrounding context unless the snippet makes it clear.

Output in Markdown for the terminal.

Use this structure when it fits:

## TL;DR

Summarize the purpose, shape, and most important takeaway.

## Map

Identify the key files, symbols, entrypoints, data structures, and responsibilities.
Use paths and line references where helpful.

## Background

Explain the relevant system context a maintainer needs before reading the target.
Stay focused on the concepts needed to understand this code.

## Core idea

Explain the central idea in plain language.
Use concrete examples or toy data when useful.

## Walkthrough

Walk through the code or change in the order that best supports understanding.
Group related behavior together rather than mechanically following file order.

## Boundaries and invariants

Explain important data flow, control flow, ownership rules, external interfaces, state transitions, error handling, lifecycle behavior, or assumptions.

## Notable concerns

Briefly mention any obvious problems, risks, surprising choices, or maintenance traps that become apparent while explaining the code.
Do not search for every possible bug.

## How to explore further

Point to useful tests, commands, logs, callers, docs, or next files to read.

Style:

- Write for a maintainer, not a beginner and not an external reviewer.
- Prefer clear mental models over exhaustive detail.
- Prefer concrete examples over abstract summaries.
- Use small tables or ASCII diagrams when they clarify.
- Quote only small snippets when needed.
- Cite file paths and line numbers for code-specific claims.
- Distinguish facts from inferred intent.
- Keep the explanation scoped to the target.