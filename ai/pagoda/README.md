# Pagoda

Local workspace for the existing Pi coding-agent setup in `../pi/`, usable in a browser or optional
Electron client. Work across sessions, follow streaming output, steer work, and explore native Pi
history without maintaining a second agent configuration.

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

Both use the selected account profile; choose another with `ai account` first. Electron requires a
graphical desktop; closing it stops the backend and active work. Browser mode keeps the backend in
the foreground until Ctrl+C, even after tabs close. Its printed URL contains a local access
credential: do not share it. Remote access is unsupported. Rebuild after source changes; see
[development](docs/development.md).

## Working with sessions

- Enter a **Working directory**, select **Use directory**, and **New session**, or reopen a saved
  session. Refresh the saved list after creating history elsewhere.
- Switch between open sessions without stopping their work. Drafts and pending commands stay with
  their original session, including across renderer reloads.
- **Send** starts idle work; **Follow up** queues input after current work; **Steer** uses Pi's
  steering boundary. When idle, both start work immediately. Model and thinking controls apply to
  the current idle session, not global defaults.
- Expand tool activity or long text to inspect full content. **History and branches** selects a
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

Pi notifications are displayed, but select/confirm/input/editor dialogs are cancelled with a visible
notice. Terminal components need graphical adaptations; the existing `ask_user_question` disables
itself outside TUI mode.

Agents have unsandboxed host filesystem and shell access; the working directory is not a security
boundary. See [execution authority](docs/domain.md#execution-authority).

## Documentation

- [Development and verification](docs/development.md): contributor workflow, checks, and display
  setup.
- [Vision](docs/vision.md): product scope and accepted direction.
- [Domain](docs/domain.md): vocabulary, behavioral invariants, and lifecycle.
- [Architecture](docs/architecture.md): process, HTTP, configuration, and security boundaries.
- [Workspace specification](docs/specs/workspace.md): agreed workflows and acceptance criteria.
- [Future work](docs/future-work.md): candidate capabilities.
- [Decisions](docs/decisions.md): stack, integration, ownership, and lifecycle rationale.
- [Agent guide](AGENTS.md): development instructions.
- [Ideas](docs/ideas.md): product brainstorming and exploration.