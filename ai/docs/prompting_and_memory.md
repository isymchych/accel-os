# Prompting and Memory

## Prompt guidelines

A prompt is a contract for work. Make the contract as small as possible while still making success
checkable.

Include only what the task needs:

- task and scope;
- output format and length constraints;
- allowed evidence or sources;
- tool-use rules;
- completion criteria;
- verification requirements.

Useful rules:

- Ask for exact sections or schemas when format matters.
- Require missing information to be called out, not invented.
- Require citations or file references for non-obvious factual claims.
- Use tools when they materially improve correctness; retry only when the result is incomplete and
  retrying is likely to help.
- For important outputs, verify format, completeness, and evidence before finalizing.
- Prefer concise progress updates during long tasks; do not narrate every action.
- Start with the smallest prompt that passes evals, then add one constraint at a time for observed
  failures.

## Memory formulation

Store memory only when it is likely to improve future behavior. Memory quality beats memory
quantity.

A good memory is:

- atomic: one testable fact, rule, preference, invariant, constraint, or rationale;
- retrieval-specific: clear trigger or boundary for when it applies;
- low-interference: unlikely to conflict with nearby memories;
- concise: usually 1-3 lines;
- decidable: an agent can tell when it is being violated.

Reject or rewrite memory that:

- bundles unrelated ideas;
- stores raw lists instead of separate atomic entries;
- lacks a trigger surface;
- preserves narrative context that will not help retrieval;
- conflicts with an existing memory without a boundary.

## Memory export prompt

Use this when asking another service to export stored memory:

```md
I'm moving to another service and need to export my data. List every memory you have stored about
me, as well as any context you've learned about me from past conversations. Output everything in a
single code block so I can easily copy it. Format each entry as: [date saved, if available] - memory
content. Preserve my words verbatim where possible. Cover: response style instructions; personal
details; projects, goals, and recurring topics; tools, languages, and frameworks; behavior
preferences and corrections; any other stored context. Do not summarize, group, or omit entries.
After the code block, confirm whether this is complete or whether any entries remain.
```