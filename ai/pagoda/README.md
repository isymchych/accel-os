# Pagoda

Local-only Electron + React UI for the existing Pi coding-agent configuration in `../pi/`. Electron
owns windows and Pi RPC children; Pi owns execution and native session persistence.

The app supports directory/session selection, independent concurrent conversations, native history
navigation and snapshot forks, streaming transcripts and tool results, follow-ups and steering,
model/thinking controls, Stop, renderer reattachment, and clean shutdown.

## Setup and run

From the repository root, install locked dependencies:

```sh
pnpm install --frozen-lockfile
```

From `ai/pagoda/`:

```sh
pnpm run build
pnpm run start
```

Or, after building, run `ai ui` from the directory where Pi should work. It uses the existing
selected account profile; choose a different one with `ai account` in the terminal first. Pass Pi
arguments through the terminal interface with `ai`; launch the desktop with `ai ui`.

The Electron npm package downloads its matching binary on first execution if it is not cached. The
app uses the repository's Node runtime to run configured Pi; it does not run agent code inside the
renderer or copy credentials into desktop storage. A graphical Linux/macOS session is required.

Production startup loads `dist/`; rebuild after source changes.

## Working with conversations

- Use **Choose directory** and **New conversation**, or reopen a saved conversation. Refresh the
  saved list after creating history elsewhere.
- Switch between open conversations without stopping their work. Drafts and pending commands stay
  with their original conversation, including across renderer reloads.
- **Send** starts idle work; **Follow up** queues input after current work; **Steer** uses Pi's
  steering boundary. When idle, both start work immediately. Model and thinking controls apply to
  the current idle session, not global defaults.
- Expand tool activity or long text to inspect full content. **History and branches** selects a
  native entry; **Navigate** changes the active branch when idle without deleting other history.
  Selecting a user message other than the current leaf moves to its parent and restores that
  message's text to the composer; selecting the current leaf is a no-op.
- **Fork conversation** copies persisted history through the selected entry into an independent
  session. The source keeps running; unfinished output and runtime fork hooks are excluded.

CLI/GUI handoff is sequential: close the terminal session before reopening it here, and quit the
desktop before resuming its sessions in the terminal. Lost acknowledgements preserve drafts but do
not trigger automatic resubmission.

Renderer refresh keeps Pi running. Quitting the app closes Pi and active work. Reopen persisted
history through Pi; unfinished execution requires a fresh run after an app or machine crash.

### Keyboard navigation

Outside text inputs, use `j` / `k` to scroll, `Ctrl+d` / `Ctrl+u` for half pages, and `gg` / `G` for
the page start/end. `i` focuses the message input; `Esc` returns to navigation without stopping the
agent. `[` / `]` select the previous/next open conversation without wrapping or interrupting work.
Press `?` or click **Keyboard shortcuts** for help. Menus and dialogs keep their own key handling.
These shortcuts do not submit prompts or provide Vim text editing.

## Configuration and compatibility

The desktop reuses the terminal's `ai/pi/` configuration and native session storage rather than
maintaining separate agent settings or credentials.

`AI_CWD` retains its existing launch-directory override.

Notifications are displayed. RPC select/confirm/input/editor dialogs receive explicit cancellation
with a visible notice; other presentation-only records are not rendered. Terminal components require
React adaptations; the existing `ask_user_question` disables itself outside TUI mode.

Agents have unsandboxed host filesystem and shell access; the working directory is not a security
boundary. See [execution authority](docs/domain.md#execution-authority).

## Documentation

- [Development and verification](docs/development.md): contributor workflow, checks, and display
  setup.
- [Vision](docs/vision.md): product scope and accepted direction.
- [Domain](docs/domain.md): vocabulary, behavioral invariants, and lifecycle.
- [Architecture](docs/architecture.md): process, IPC, configuration, and security boundaries.
- [Workspace specification](docs/specs/workspace.md): agreed workflows and acceptance criteria.
- [Future work](docs/future-work.md): candidate capabilities.
- [Decisions](docs/decisions.md): stack, integration, ownership, and lifecycle rationale.
- [Agent guide](AGENTS.md): development instructions.
- [Ideas](docs/ideas.md): product brainstorming and exploration.