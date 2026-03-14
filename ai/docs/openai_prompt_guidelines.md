# Prompt Guidelines

A practical guide for writing prompts that produce reliable, compact, and verifiable outputs.

## Purpose

Use prompts as **contracts**, not just requests.
A good prompt defines:
- the task
- the expected output shape
- what evidence or tools may be used
- how the model should verify results
- what counts as done

## Core Principles

### 1. Define the output contract
State exactly what should be returned.

Include:
- required sections
- required order
- allowed format (`JSON`, `Markdown`, `SQL`, `XML`, plain text)
- any length limits
- whether extra commentary is forbidden

Example:

```md
Return exactly these sections in order:
1. Summary
2. Risks
3. Recommendation
Output Markdown only.
Do not include preamble or closing remarks.
```

### 2. Be explicit about completion
Say what “done” means.

Useful completion rules:
- all requested items are covered
- missing information is called out explicitly
- tool results are checked before finalizing
- no required section is omitted
- the model should not stop at the first plausible answer

Example:

```md
Do not finish until all 12 items are classified.
If one item is ambiguous, mark it as ambiguous and explain why.
```

### 3. Keep structure tight
Constrain format and verbosity.

Prefer:
- small, well-named sections
- exact schemas for parse-sensitive outputs
- concise answers with no filler
- explicit rules for whether reasoning should be exposed or hidden

For strict formats:

```md
Output valid JSON only.
No markdown fences.
Schema:
{ "title": string, "priority": "low" | "medium" | "high" }
```

### 4. Ground claims in evidence
Require the model to use only the provided context or retrieved sources.

Good rules:
- do not invent facts or citations
- cite claims that depend on external information
- label unsupported conclusions as assumptions or inferences
- distinguish retrieved facts from synthesis

Example:

```md
Use only the supplied documents.
For every non-obvious factual claim, include a citation.
If evidence is missing, say so directly.
```

### 5. Make tool use explicit
If tools are available, define when to use them and when not to.

Specify:
- when a tool is required
- when a tool is optional
- whether retries are expected
- whether the model should continue after partial results
- which actions require verification before execution

Example:

```md
Use web search for any claim that may be time-sensitive.
If the first search is incomplete, refine the query and try again.
Do not finalize until the result is verified against at least one authoritative source.
```

### 6. Choose reasoning effort by task shape
More reasoning is not always better.

General guidance:
- **low / none**: straightforward transformations, formatting, routine execution
- **medium**: multi-step analysis, ambiguity resolution, non-trivial planning
- **high**: research-heavy synthesis, strategy, safety-critical review, complex dependency analysis

Before increasing reasoning effort, first improve:
- output contract clarity
- completeness checks
- verification rules
- tool-use rules

### 7. Add lightweight verification
For important tasks, require a final check.

Useful verification patterns:
- validate schema before returning
- compare result against source material
- confirm all requested items were handled
- run one sanity check for high-stakes tasks
- verify preconditions before irreversible actions

Example:

```md
Before finalizing:
- verify the JSON is valid
- verify every recommendation is supported by evidence
- verify no requested section is missing
```

### 8. Keep long-running tasks persistent
For agents and multi-step workflows, tell the model to continue until the task is actually complete.

Helpful rules:
- do not stop after partial progress
- recover from empty or weak results
- retry with a refined approach when useful
- keep track of remaining subtasks
- surface blockers clearly instead of silently skipping work

Example:

```md
Maintain a checklist of unresolved items.
If a step fails, attempt one reasonable recovery path before giving up.
```

### 9. Use user updates sparingly
For interactive agents, require short progress updates during long tasks.

Good update rules:
- keep updates brief
- mention meaningful progress only
- surface blockers early
- avoid repeating the plan every time

Example:

```md
For tasks that take multiple steps, provide brief progress updates after major milestones.
Do not narrate every low-level action.
```

### 10. Start minimal, then iterate
Do not overbuild prompts up front.

Recommended process:
1. start with the smallest prompt that passes evals
2. measure failures
3. add only the block that fixes the observed failure mode
4. retest
5. change one thing at a time

## Reusable Prompt Blocks

### Output contract
```xml
<output_contract>
- Return exactly the requested sections, in the requested order.
- If a specific format is required, output only that format.
- Do not include extra commentary.
- Respect per-section length limits.
</output_contract>
```

### Completeness contract
```xml
<completeness_contract>
- Do not stop at the first plausible answer.
- Ensure every requested item is addressed.
- If something cannot be completed, state what is missing.
- Do not finalize while required work remains.
</completeness_contract>
```

### Verification loop
```xml
<verification_loop>
- Before finalizing, verify the output against the prompt requirements.
- Check format validity, completeness, and evidence support.
- For important tasks, perform at least one sanity check.
</verification_loop>
```

### Citation rules
```xml
<citation_rules>
- Use only provided or retrieved sources.
- Do not invent citations.
- Cite non-obvious factual claims.
- Label inferences clearly.
</citation_rules>
```

### Tool persistence rules
```xml
<tool_persistence_rules>
- Use tools when they materially improve correctness.
- If results are incomplete, refine and retry.
- Do not finalize if tool-based verification is still needed.
- Respect tool boundaries and action constraints.
</tool_persistence_rules>
```

### Dig deeper nudge
```xml
<dig_deeper_nudge>
- Don’t stop at the first plausible answer.
- Check edge cases, hidden constraints, and second-order issues.
- For safety- or accuracy-critical tasks, verify before concluding.
</dig_deeper_nudge>
```

## Recommended Template

```md
# Role
You are a careful assistant working on a constrained task.

# Task
[Describe the job clearly and specifically]

# Output Contract
- [required sections / schema / format]
- [ordering rules]
- [verbosity constraints]

# Grounding Rules
- [allowed sources]
- [citation requirements]
- [assumption rules]

# Tool Rules
- [when to use tools]
- [when to retry]
- [what must be verified before finalizing]

# Completion Criteria
- [definition of done]
- [coverage requirements]
- [failure-handling expectations]

# Final Checks
- [schema validation]
- [completeness check]
- [evidence check]
```

## Common Failure Modes and Fixes

### Failure: Output drifts in format
Fix:
- require exact format
- forbid extra commentary
- provide a schema or section list

### Failure: Stops too early
Fix:
- add a completeness contract
- define explicit done criteria
- require unresolved-item tracking

### Failure: Hallucinates facts
Fix:
- tighten grounding rules
- require citations
- forbid unsupported claims

### Failure: Uses tools poorly
Fix:
- specify when tools are mandatory
- define retry behavior
- define verification before finalization

### Failure: Overly verbose
Fix:
- constrain section lengths
- ask for direct answers only
- separate hidden work from visible output

### Failure: Too literal or shallow
Fix:
- add a dig-deeper nudge
- add verification expectations
- only then consider raising reasoning effort

## Practical Defaults

For most production prompts:
- define exact output shape
- define what counts as done
- require evidence for factual claims
- require tool use for time-sensitive facts
- add a lightweight verification step
- keep visible output compact

## One-Page Checklist

Before shipping a prompt, confirm:
- Is the task specific?
- Is the output format explicit?
- Is “done” clearly defined?
- Are grounding and citation rules clear?
- Are tool-use boundaries explicit?
- Is there a verification step?
- Is verbosity constrained?
- Did you add only the rules you actually need?

## Source Basis

This document is based primarily on current OpenAI prompt guidance for GPT-5.4, especially its emphasis on:
- explicit output contracts
- completeness and verification
- disciplined tool use
- citation gating
- reasoning-effort selection by task shape
- gradual prompt migration and iteration

