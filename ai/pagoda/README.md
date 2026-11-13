# Pagoda

Local workspace built on the Pi SDK, usable in a browser or optional Electron client. Work across
sessions, follow streaming output, steer work, and explore native Pi history. Pagoda shares
instructions and account credentials with terminal Pi while owning its execution configuration.

## Setup and run

From the repository root, install locked dependencies:

```sh
pnpm install --frozen-lockfile
```

From `ai/pagoda/`:

```sh
pnpm run build
```

From the directory where Pi should work, choose either:

```sh
ai ui
ai ui --browser
```

Electron requires a graphical desktop; closing it stops the backend and active work. Browser mode
keeps the backend foreground until Ctrl+C, even after tabs close. Its printed URL contains a local
access credential: do not share it. Remote access is unsupported.

Rebuild after source changes; see [development](docs/development.md).

## Working with sessions

- Choose an account for new sessions; existing sessions retain their original account. Login and
  account creation remain in terminal Pi (`ai account`).
- Enter a **Working directory** to create a session, or **Browse sessions** to reopen native Pi
  history. Refresh to see history created elsewhere.
- Switch sessions without stopping work. **Follow up** queues input; **Steer** intervenes at Pi's
  steering boundary. Press `?` outside text inputs for keyboard shortcuts.

Close a terminal session before opening it in Pagoda, and stop the backend before resuming its
sessions in the terminal. Clients share execution but keep independent drafts and selections. A lost
connection does not mean work stopped; uncertain submissions are not resent automatically. After a
crash, reopen saved history and start unfinished work again.

See the [workspace specification](docs/specs/workspace.md) for session, history, and failure
behavior.

## Configuration

Set `sidebar.inactivityHours` in `ai/pi/pagoda-settings.json` to control when idle, unpinned
sessions leave Recent; the default is 48 hours. Restart the backend after changing it. Recent uses
native Pi activity, including CLI work after refreshing the session catalog. Pins and favourites are
stored separately in the ignored `ai/pi/pagoda-state.json`.

Pagoda shares skills, prompts, system instructions, and native history with terminal Pi, but owns
its tools and execution configuration. Terminal code-navigation selections (`srcwalk` and `tilth`)
are not accepted by `ai ui`. Unsupported Pi dialogs are cancelled with a visible notice.

Agents have unsandboxed host filesystem and shell access under your permissions, without approval
gates. The working directory is not a security boundary.

## Documentation

- [Development and verification](docs/development.md): contributor workflow, checks, and display
  setup.
- [Vision](docs/vision.md): product direction and scope.
- [Domain](docs/domain.md): concepts and invariants.
- [Workspace specification](docs/specs/workspace.md): behavioral contract.
- [Architecture](docs/architecture.md): system structure and boundaries.
- [Future work](docs/future-work.md): candidate capabilities.
- [Decisions](docs/decisions.md): current technical choices and rationale, with links to history.
- [Agent guide](AGENTS.md): development instructions.
- [Ideas](docs/ideas.md): non-binding scratchpad, including out-of-scope exploration.