# Pagoda vision

A local web workspace, with an optional Electron client, built on the Pi SDK. It provides a
graphical way to follow agent work, manage sessions, and explore native Pi history.

## Product direction

- **Native Pi sessions, Pagoda's execution environment.** View regular terminal Pi histories and
  continue them using Pagoda's tools and instructions, with shared native session format and
  storage.
- **A workspace for agent work.** Make ongoing activity, results, and failures understandable, with
  direct controls for input, cancellation, and session navigation.
- **Local, single-user.** Serve the user on their own machine, without a managed background service.

## Scope boundaries

Saved projects, remote access, orchestration, multi-user services, a managed background service,
automatic crash recovery, an application-owned plugin platform, and uninterrupted backend upgrades
are outside scope.

Additional Pi capabilities enter UI scope through an explicit product decision.