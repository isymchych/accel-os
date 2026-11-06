# Noctalia migration

## Status

Migration, night light, polkit dialogs, unified appearance, and native screenshots are accepted as
complete by the user. Obsolete package and configuration cleanup is complete. No further acceptance
or cleanup is open for those integrations.

VPN remains postponed pending a stable release with native VPN secret handling. The optional later
integrations remain outside approved implementation scope.

## Deferred: production VPN

Noctalia's native networking UI is deployed, but installed version 5.4.1 lacks VPN secret handling.
Wait for a stable release containing upstream PR #5076; do not substitute an unreleased build. Keep
nm-applet autostarting through `sway-session.target` and `network-manager-applet` installed until
the native workflow passes acceptance without nm-applet running.

When VPN work resumes:

- Confirm the installed stable release includes PR #5076 before retrying the native workflow.
- Investigate the secrets failure before changing credential storage. Saved connections,
  credentials, and authentication-storage settings must remain unchanged unless separately
  authorized; system-wide password storage is not approved.
- Use native Noctalia controls for production VPN, not a terminal wrapper. Preserve the independent
  development OpenVPN/TOTP script.
- Verify production connect/disconnect, credentials, and cancellation without nm-applet running.
  Also check needed Wi-Fi/wired workflows, advanced editing through `nm-connection-editor`, no
  duplicate network UI after fresh login, and the unchanged development script.
- Remove the retained applet package only after acceptance and explicit removal authorization.

Keep NetworkManager, `networkmanager-openvpn`, `nm-connection-editor`, and the keyring; this is a UI
replacement, not an infrastructure replacement.

## Native screenshots

Noctalia owns capture and annotation. `Print` starts region selection before annotation, `Alt+Print`
captures the focused window, and `Shift+Print` opens the native output picker (immediate capture on
one output). These are direct shortcuts, not a Sway mode or a custom chooser.

Keep region confirmation enabled: select a region, press Enter, then annotate. Saves retain
`~/temp/screenshots`, and closing the editor does not implicitly copy. Live copy/paste remains
available with native clipboard history disabled. Keep grim/slurp for the color picker and
recording.

## Optional later integrations

Keep the existing workflows unless a separate replacement is agreed:

- **Clipboard:** preserve templates, emoji search, saving, thumbnails, custom keys, and shortcuts.
  Evaluate keyring-backed persistence; retire cliphist watchers together with any replacement rather
  than collecting history twice.
- **Locking, idle, and session actions:** consider these together, last. Agree on
  authentication/PAM, lock-before-sleep, idle timeouts, output power/wake, confirmations, and
  shell-failure behavior before replacing existing owners. Preserve security and suspend/resume
  behavior; visual consistency alone is not a reason to weaken them.

## Retained boundaries

- Sway owns the compositor and graphical session. Noctalia supplies desktop UI inside that session;
  it does not launch Sway or replace the session launcher.
- Preserve Pi working/waiting status, stale/non-agent filtering, and the combined system/user
  failed-unit indicator. Leave the Pi activity producer and protocol unchanged.
- Keep `mb-clipboard`, `mb-lock-screen`, `mb-exit`, Fuzzel, cliphist, swaylock, swayidle, kanshi,
  and udiskie while their workflows remain. Native clipboard history, locking, and idle management
  stay disabled; session actions retain the existing confirmation/lock flow.
- Keep polkit itself, portals, PipeWire, the keyring, and NetworkManager. Consolidating their UI
  does not authorize removing the underlying infrastructure.
- Noctalia is the single appearance authority. Preserve curated application palettes, native user
  templates, disabled built-in/community recoloring, and the confirmed manual location with online
  lookup disabled. Night-light temperature remains independent of application appearance.
- Manage configuration through Git and chezmoi. Reconcile conflicting Noctalia state overrides
  explicitly without deleting unrelated state. Rollback uses scoped Git/chezmoi changes and process
  reconciliation or relogin, not a parallel fallback stack; restoring files alone does not restore
  running processes.

## Current configuration

- [Noctalia settings and templates](../dotfiles/dot_config/noctalia/)
- [Sway configuration](../dotfiles/dot_config/sway/config) and
  [session services](../dotfiles/dot_config/systemd/user/)
- [Package inventory](../dotfiles/.chezmoidata/packages.yaml) and
  [exact retired-file list](../dotfiles/.chezmoiremove)
- [Linux setup guide](../docs/linux/README.md)