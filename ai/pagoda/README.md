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

Choose the account for new sessions inside Pagoda; existing sessions retain their original account.
Login and account creation remain in terminal Pi (`ai account`). Electron requires a graphical
desktop; closing it stops the backend and active work. Browser mode keeps the backend in the
foreground until Ctrl+C, even after tabs close. Its printed URL contains a local access credential:
do not share it. Remote access is unsupported. Rebuild after source changes; see
[development](docs/development.md).

## Working with sessions

- Enter a **Working directory**, select **Use directory**, and **New session**, or use **Browse
  sessions** to search and reopen history across directories. Refresh after creating history
  elsewhere.
- The sidebar keeps pinned and recently active sessions. Favourites can be filtered in Sessions
  independently of pins. Switch sessions without stopping their work; drafts and pending commands
  stay with their original session across renderer reloads.
- **Send** starts idle work; **Follow up** queues input after current work; **Steer** uses Pi's
  steering boundary. When idle, both start work immediately. Model and thinking controls apply to
  the current idle session, not global defaults.
- Expand tool activity or long text to inspect full content. **Conversation history** selects a
  native entry; **Navigate** changes the active branch when idle without deleting other history.
- **Fork session** copies persisted history through the selected entry into an independent session.
  The source keeps running; unfinished output is excluded.

CLI/GUI handoff is sequential: close the terminal session before reopening it here, and stop the
backend before resuming its sessions in the terminal. Lost acknowledgements preserve drafts but do
not trigger automatic resubmission.

Clients share execution but keep independent drafts and selections. A lost connection does not mean
work stopped. After a backend or machine crash, reopen saved history; unfinished execution requires
a fresh run. See the [workspace specification](docs/specs/workspace.md) for detailed behavior.

### Keyboard navigation

Outside text inputs, use `j` / `k` to scroll, `Ctrl+d` / `Ctrl+u` for half pages, and `gg` / `G` for
the page start/end. `i` focuses input; `Esc` returns to navigation without stopping work. `[` / `]`
switch sessions. Press `?` or click **Keyboard shortcuts** for the full reference.

## Configuration and compatibility

Set `sidebar.inactivityHours` in `ai/pi/pagoda-settings.json` to control when idle, unpinned
sessions leave Recent; the default is 48 hours. Restart the backend after changing it. Recent uses
native Pi activity, including CLI work after refreshing the session catalog. Pins and favourites are
stored separately in the ignored `ai/pi/pagoda-state.json`.

Pagoda loads the shared skills, prompt templates, and system instructions, but uses its own SDK
tools rather than terminal Pi's extensions. Terminal code-navigation selections (`srcwalk` and
`tilth`) are not accepted by `ai ui`. Pi notifications are displayed; unsupported dialogs are
explicitly cancelled with a visible notice.

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
- [Decisions](docs/decisions.md): technical tradeoffs and history.
- [Agent guide](AGENTS.md): development instructions.
- [Ideas](docs/ideas.md): product brainstorming and exploration.