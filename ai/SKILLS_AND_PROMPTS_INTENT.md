# Design principles

- Context before code. Gather requirements and inspect the relevant implementation before proposing changes.
- Read-only by default. Investigation, review, and verification should not unexpectedly mutate code or external systems.
- Evidence over guesses. Distinguish confirmed behavior from assumptions and keep uncertainty visible.
- Explicit external actions. Posting review comments, resolving discussions, approving changes, or updating Jira should happen only when requested.
- Composable workflows. Keep individual skills focused so they can be combined rather than building one large agent prompt.
- Use existing engineering tools. Git, Jira, GitLab, Xcode, tests, and CI remain the sources of truth; the agent orchestrates them rather than replacing them.