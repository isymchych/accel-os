# Noctalia migration

## Status

Migration, night light, polkit dialogs, unified appearance, and native screenshots are accepted as
complete by the user. Obsolete package and configuration cleanup is complete. No further acceptance
or cleanup is open for those integrations.

VPN remains postponed pending a stable release with native VPN secret handling. Native clipboard
history and contextual actions, launcher emoji/templates, and native bar clicks are approved and
implemented. Automated checks pass; interactive acceptance remains pending. Locking, idle, and
session replacement remain outside implementation scope.

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
available independently of clipboard history. Keep grim/slurp for the color picker and recording.

## Clipboard, launcher, and bar clicks

Use Noctalia's native clipboard history from `Mod+i`, bound directly to
`noctalia msg panel-toggle clipboard`. History uses Noctalia's encrypted, keyring-backed storage;
keep existing cliphist data untouched, but retire both cliphist watchers so history is not collected
twice. Keep copy-only activation for history and launcher results; automatic paste stays disabled.

`Mod+Shift+i` runs `mb-clipboard-actions`, opening the separate native
`accel-os/clipboard-actions:actions` panel. It previews the current clipboard text or image and
offers contextual actions: Save As, text editing, image annotation, URL opening, YouTube downloads
through `mb-ydl`, and JSON formatting. Preview and execution use the same frozen snapshot. Save As
belongs in this actions panel, not inside native clipboard history.

Emoji belongs in the launcher's `/emo` provider. Tracked template files remain canonical and are
available through `/tpl`, backed by the small `mb-template list` and `mb-template copy <name>`
commands. The old three-mode picker and custom mode keys are not carried over.

Clock, speaker/microphone, Bluetooth, and system-monitor left-clicks use native Control Center tabs.
Right-click opens `bluetui` on Bluetooth, `pavucontrol` on the speaker, its recording tab on the
microphone, `dust` for `/home` on the disk indicator, and `htop` sorted by CPU or memory on the
corresponding indicators. Clock and temperature right-clicks remain disabled. Preserve disabled
microphone and workspace scrolling. Keep the external tools used by these right-click actions.

Translation integration is declined. Keep offline mode enabled and do not enable a translation
plugin.

Verify history search, image previews, copy/paste, pinning/deletion, persistence after relogin,
clipboard action previews, keyboard navigation and dismissal, `/emo`, `/tpl`, and native panel
clicks interactively before accepting this integration.

## Optional later integrations

Keep the existing workflows unless a separate replacement is agreed:

- **Locking, idle, and session actions:** consider these together, last. Agree on
  authentication/PAM, lock-before-sleep, idle timeouts, output power/wake, confirmations, and
  shell-failure behavior before replacing existing owners. Preserve security and suspend/resume
  behavior; visual consistency alone is not a reason to weaken them.

## Retained boundaries

- Sway owns the compositor and graphical session. Noctalia supplies desktop UI inside that session;
  it does not launch Sway or replace the session launcher.
- Preserve Pi working/waiting status, stale/non-agent filtering, and the combined system/user
  failed-unit indicator. Leave the Pi activity producer and protocol unchanged.
- Keep `mb-template` as the launcher template helper. Keep `mb-lock-screen`, `mb-exit`, Fuzzel,
  swaylock, swayidle, kanshi, and udiskie while their workflows remain. Native locking and idle
  management stay disabled; session actions retain the existing confirmation/lock flow.
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