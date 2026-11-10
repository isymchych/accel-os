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

## First release

The first release makes local Pi conversations usable graphically, from choosing a session to
directing and reviewing its work. [MVP.md](mvp.md) defines the committed workflows and acceptance
checks; [README.md](../README.md) describes what works now.

## Scope boundaries

Standalone-browser access, saved projects, remote hosts, orchestration, multi-user services,
background execution, automatic crash recovery, an application-owned plugin platform, and
uninterrupted main-process upgrades are outside scope.

Graphical extension interactions (including `ask_user_question`), a graphical selector for existing
account profiles, credential-management screens, a rich graphical history tree, an embedded
terminal, a file explorer/editor, installers, and distribution packaging are deferred. A future
profile selector would use the existing Pi profile system. Additional Pi capabilities enter UI scope
through an explicit product decision.

[DOMAIN.md](domain.md) defines session behavior; [ARCHITECTURE.md](architecture.md) defines
integration and execution authority. [IDEAS.md](ideas.md) retains nonbinding brainstorming.