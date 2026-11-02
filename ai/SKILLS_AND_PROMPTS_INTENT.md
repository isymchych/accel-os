# Design principles

- Enable judgment, not ritual. Give agents clear outcomes, constraints, and useful procedures
  without overprescribing execution. Every mandatory step should protect a concrete boundary or
  materially improve results.
- Write instructions that prevent plausible mistakes. State when the rule applies and what to do
  instead; pair restrictions with an actionable alternative where possible. Prefer consequential,
  non-obvious knowledge over repository inventories or generic advice.
- Context before code. Gather requirements and inspect the relevant implementation before proposing
  changes.
- Read-only by default. Investigation, review, and verification should not unexpectedly mutate code
  or external systems.
- Evidence over guesses. Distinguish confirmed behavior from assumptions and keep uncertainty
  visible.
- Explicit external actions. Posting review comments, resolving discussions, approving changes, or
  updating Jira should happen only when requested.
- Composable workflows. Keep individual skills focused so they can be combined rather than building
  one large agent prompt.
- Independent skills. Keep skills usable without the system prompt that selects them. Reference
  focused supporting material rather than enclosing agent configuration.
- Place guidance by when it is needed. Keep broadly applicable constraints in persistent
  instructions, task-specific procedures in on-demand skills, and detailed explanations in canonical
  documentation. Use narrower scope when it meaningfully reduces irrelevant context.
- Use existing engineering tools. Git, Jira, GitLab, Xcode, tests, and CI remain the sources of
  truth; the agent orchestrates them rather than replacing them.
- avoid hypothetical concerns