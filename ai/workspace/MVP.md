# Pi workspace first release

[VISION.md](VISION.md) defines product scope. Release workflows must preserve the
[domain rules](DOMAIN.md) and [architectural boundaries](ARCHITECTURE.md).

Checkboxes track implementation status, not release verification: checked items are present in the
inspected implementation; unchecked items are missing or partial. Acceptance checks below still
apply to the complete release.

## Release outcomes

- [x] **Launch with the existing setup:** `ai` retains terminal behavior; `ai ui` opens the built
      desktop with the launch directory and selected profile, using the canonical RPC entry and
      Pi-owned configuration, credentials, resources, and storage.
- [ ] **Manage conversations:** choose directories; browse, create, and reopen native sessions; read
      history and navigate or fork branches without losing original history.
- [ ] **Work across sessions:** navigate between sessions without interrupting other active work.
      Keep each session's draft and activity independent. Switching views must not stop or retarget
      execution; commands remain bound to their intended session even if selection changes while
      they are pending.
- [ ] **Follow agent work:** read transcripts, streaming text, meaningful tool activity/results,
      connection/execution state, errors, and unsupported-interaction notices, including long
      content.
- [ ] **Keep long conversations responsive:** avoid cloning and sending the entire transcript over
      IPC on every streaming delta. `DesktopSession.update()` currently clones full snapshots for
      listeners, which main forwards to the renderer. Consider coalesced notifications before a more
      complex state protocol.
- [ ] **Direct the agent:** submit input and explicit follow-ups distinct from steering; choose
      models and thinking levels through Pi's existing configuration/runtime.
- [ ] **Complete graphical interactions:** adapt required extension interactions to React,
      especially `ask_user_question`; explicitly cancel unsupported dialogs with a visible notice.
- [x] **Handle uncertainty safely:** retain drafts after rejected or uncertain submission and
      require Pi confirmation for Stop.
- [x] **Preserve the execution lifetime:** renderer refresh reattaches to current state without
      stopping work; application quit closes children and active work.

[README.md](README.md) describes currently supported usage. Unchecked outcomes remain missing or
partial; graphical profile selection and credential management are deferred.

Existing Node integration and Electron E2E tests cover parts of the foundation. A configured-Pi test
exercises actual extensions with a local fake model, a harmless read, and native persistence; it
does not establish compatibility for all configured tools or required graphical interactions.

## Acceptance checks

Use fake providers or deterministic fake execution, harmless tools, and isolated temporary state.
Never use real provider credentials in automated tests. [README.md](README.md#checks) owns commands
and display prerequisites.

### Launch and runtime

- Launcher parsing selects UI without changing ordinary Pi passthrough or account selection. Reject
  unsupported UI arguments rather than sending them to Pi.
- Profile, launch directory, and code-navigation selection reach the desktop without mutating
  terminal launcher configuration.
- Node integration checks cover JSONL chunking/Unicode separators, final-message replacement,
  request rejection, child exit, unsupported-dialog cancellation, Stop confirmation, and shutdown
  cleanup of harmless owned work.
- Electron E2E exercises the actual built React renderer, sandboxed preload, IPC, main process, and
  deterministic fake RPC child. Verify submit/stream, renderer reload during work, Stop, draft
  preservation, untrusted text rendering, and clean quit.
- Typecheck, lint, formatting, build, and repository checks pass, or outstanding failures are
  reported precisely.
- Configured-Pi checks use synthetic credentials and local fake model execution. A fake RPC child
  verifies application wiring; real extension compatibility requires configured-Pi checks.

### Session workflows

Verify directory/session selection, sequential CLI/GUI handoff, persisted-history reopening,
branch/fork preservation, explicit follow-ups, model/thinking controls, independent session
activity, and graphical extension interactions.

- Run work in session A, switch to B and submit there, then return to A. Verify work continues
  independently and histories and drafts remain separate.
- Verify Stop targets only the intended session, including when selection changes while the request
  is pending.
- Reopening an already active session reuses its execution owner rather than creating a second
  writer.
- Forking preserves the source session's history and active work.

A lost command response remains an uncertain submission, not permission to resend automatically.
Stop success requires Pi confirmation; verify real tool process termination against the actual
configured tools as well as fake execution. Report verification limits explicitly.