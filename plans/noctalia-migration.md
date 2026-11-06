# Noctalia migration

## Status

The desktop migration, interactive acceptance, and obsolete-stack cleanup are complete, including
native locking, idle behavior, and session actions. Do not reopen completed acceptance or cleanup.
Only native production VPN remains deferred.

## Remaining work: production VPN

Resume only after confirming an installed stable release includes VPN secret handling from upstream
PR #5076; do not substitute an unreleased build. Keep nm-applet autostarting through
`sway-session.target` and retain `network-manager-applet` until native acceptance passes without the
applet running.

When resuming:

- Investigate the secrets failure before changing credential storage. Saved connections,
  credentials, and authentication-storage settings require separate authorization to change;
  system-wide password storage is not approved.
- Use native Noctalia controls for production VPN, not a terminal wrapper. Preserve the independent
  development OpenVPN/TOTP script.
- Verify connect/disconnect, credentials, and cancellation without nm-applet; needed Wi-Fi/wired
  workflows; advanced editing through `nm-connection-editor`; no duplicate network UI after fresh
  login; and the unchanged development script.
- Remove the applet package only after acceptance and explicit removal authorization. Retain
  NetworkManager, `networkmanager-openvpn`, `nm-connection-editor`, and the keyring.

After VPN acceptance and removal authorization, remove
`dotfiles/dot_config/systemd/user/nm-applet.service`, its `Wants=` entry in
`dotfiles/dot_config/systemd/user/sway-session.target`, and the `network-manager-applet` package
declaration and installed package. Add `.config/systemd/user/nm-applet.service` to the Linux
retired-file list, stop the applet, apply the scoped removal, reload user systemd, and verify a
fresh login has no duplicate network UI.

## Retained constraints

- **Ownership:** Sway owns the compositor and graphical session; Noctalia supplies desktop UI, not
  the session launcher. Noctalia owns locking, idle behavior, and session-action UI. Keep kanshi and
  udiskie. Do not reinstate the retired locking/session stack as a parallel fallback.
- **Locking and session:** keep native fingerprint support and animations, unchanged PAM,
  authenticated unlocking without a grace period, and lock-before-sleep. Do not add idle suspend.
  Use native cancellable countdowns rather than yes/no prompts; omit hibernate from the menu without
  changing system hibernation support. Timings and shortcuts live in the configuration.
- **Infrastructure:** retain polkit, portals, PipeWire, the keyring, and NetworkManager. Replacing
  UI does not authorize removing infrastructure. Keep external tools used by bar right-clicks, and
  grim/slurp for the color picker and recording.
- **Status:** preserve Pi working/waiting status, stale/non-agent filtering, and combined
  system/user failed-unit reporting. Leave the Pi activity producer/protocol unchanged.
- **Appearance and privacy:** Noctalia is the single appearance authority. Preserve curated
  palettes, native user templates, disabled built-in/community recoloring, manual location with
  online lookup disabled, and night-light temperature independent of application appearance. Keep
  offline mode enabled; translation integration is declined.
- **Clipboard and launcher:** retain native encrypted, keyring-backed history without duplicate
  cliphist watchers or deleting existing cliphist data. Keep history/launcher activation copy-only,
  with automatic paste disabled. Clipboard actions must preview and execute the same frozen
  snapshot; Save As belongs in the separate actions panel, not history. Keep tracked templates
  canonical and `mb-template` as the launcher helper.
- **Accepted interaction choices:** preserve screenshot region confirmation, explicit copy rather
  than copy-on-close, `~/temp/screenshots` saves, and live copy/paste independent of history. Keep
  microphone/workspace scrolling and clock/temperature right-clicks disabled. Shortcut and widget
  details live in the linked configuration rather than this plan.
- **Configuration and rollback:** manage through Git/chezmoi. Reconcile conflicting Noctalia state
  overrides explicitly without deleting unrelated state. Roll back with scoped changes plus process
  reconciliation or relogin, not a parallel fallback stack; files alone do not restore running
  processes.

**Fingerprint caveat:** Noctalia's independent fprintd reader does not use the existing PAM rule
that skips fingerprint authentication with the lid closed. Native fingerprint support remains
enabled by choice; investigate only if closed-lid use causes a practical problem.

## Configuration

- [Noctalia settings and templates](../dotfiles/dot_config/noctalia/)
- [Sway configuration](../dotfiles/dot_config/sway/config) and
  [session services](../dotfiles/dot_config/systemd/user/)
- [Package inventory](../dotfiles/.chezmoidata/packages.yaml) and
  [retired-file list](../dotfiles/.chezmoiremove)
- [Linux setup guide](../docs/linux/README.md)