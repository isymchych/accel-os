---
name: agentsmd-cleanup
description: Refactor AGENTS.md to follow progressive disclosure. Use when asked to audit, simplify, or reorganize AGENTS.md; identify contradictions; split instructions into linked category files; propose docs structure; and flag deletions (redundant/vague/obvious).
---

# AGENTS.md Progressive Disclosure Refactor

Progressive disclosure: keep root AGENTS.md minimal (global rules + essential commands + links); move all other guidance into linked category files.

## Inputs to confirm
- Target AGENTS.md path.
- Repo root (if not obvious).
- Whether to write files or only propose changes.

## Workflow
1) **Scan for contradictions**
   - List conflicts as pairs (or groups) with exact quotes.
   - Ask user to pick the version to keep.
   - Do not resolve without explicit user choice; if no choice, stop and re-offer the options.

2) **Extract essentials for root AGENTS.md**
   - One-sentence project description.
   - Package manager if not npm.
   - Non-standard build/typecheck/test commands.
   - Rules relevant to every single task.
   - Keep root minimal; prefer links.

3) **Group remaining instructions**
   - Cluster by purpose (e.g., language conventions, testing, APIs, Git workflow, tooling, design heuristics).
   - Create one Markdown file per group.
   - Keep file titles consistent and specific.

4) **Draft structure + contents**
   - Output minimal root AGENTS.md with links.
   - Output each group file with its content.
   - Suggest a docs/ folder layout for these files.

5) **Flag for deletion**
   - Mark instructions that are redundant, vague, or obvious.
   - Provide brief reason per item.

## Output format
- Section: Contradictions (with questions).
- Section: Root essentials (proposed content).
- Section: Grouped files (file path + content).
- Section: Suggested docs structure (tree list).
- Section: Deletion candidates (bulleted list + reason).

## Guardrails
- Keep wording concise; avoid filler.
- Prefer explicit dates if user references relative time.
- Ask only necessary clarifying questions.
- Do not edit files unless explicitly requested.
