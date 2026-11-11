# Pi workspace vision

A local desktop workspace for interacting with the existing Pi coding-agent setup. It provides a
graphical way to follow agent work, manage conversations, and explore history without creating a
second agent configuration or execution system.

## Product direction

- **One Pi setup, two interfaces.** Terminal and desktop use the same profiles, resources, and
  native sessions. Moving between them should not require maintaining parallel settings.
- **A workspace for agent work.** Make ongoing activity, results, and failures understandable, with
  direct controls for input, cancellation, and conversation navigation.
- **Local and app-owned.** Serve one local user on the host machine. Execution belongs to the
  desktop application's lifetime, not a background service.

## Scope boundaries

Standalone-browser access, saved projects, remote hosts, orchestration, multi-user services,
background execution, automatic crash recovery, an application-owned plugin platform, and
uninterrupted main-process upgrades are outside scope.

Additional Pi capabilities enter UI scope through an explicit product decision.