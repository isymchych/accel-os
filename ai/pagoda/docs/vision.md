# Pagoda vision

A local web workspace, with an optional Electron client, for the existing Pi coding-agent setup. It
provides a graphical way to follow agent work, manage sessions, and explore history without creating
a second agent configuration or execution system.

## Product direction

- **One Pi setup.** Terminal and graphical clients use the same profiles, resources, and native
  sessions. Moving between them should not require maintaining parallel settings.
- **A workspace for agent work.** Make ongoing activity, results, and failures understandable, with
  direct controls for input, cancellation, and session navigation.
- **Local, single-user.** Serve the user on their own machine, without a managed background service.

## Scope boundaries

Saved projects, remote access, orchestration, multi-user services, a managed background service,
automatic crash recovery, an application-owned plugin platform, and uninterrupted backend upgrades
are outside scope.

Additional Pi capabilities enter UI scope through an explicit product decision.