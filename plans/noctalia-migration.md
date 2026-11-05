# Noctalia migration

## Status

Migration, night light, polkit dialogs, and unified appearance are accepted as complete by the user.
Obsolete package and configuration cleanup is complete. No further acceptance or cleanup is open for
those integrations.

VPN is the only unfinished integration and is postponed. The optional replacements below are not
approved implementation scope.

## Deferred: production VPN

Noctalia's native networking UI is deployed, but production VPN authentication failed to obtain
secrets. The applet is no longer started by Sway; keep `network-manager-applet` installed until the
native workflow passes acceptance without nm-applet running.

When VPN work resumes:

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

## Optional later integrations

Keep the existing workflows unless a separate replacement is agreed:

- **Clipboard:** preserve templates, emoji search, saving, thumbnails, custom keys, and shortcuts.
  Evaluate keyring-backed persistence; retire cliphist watchers together with any replacement rather
  than collecting history twice.
- **Screenshots:** preserve `mb-screenshot` and its shortcuts, including focused-window and
  multi-output capture, delays, annotation, output location, cancellation, and clipboard behavior.
  Native clipboard output depends on native clipboard integration. Retain grim/slurp/Satty unless
  their workflows are covered or a behavior change is accepted.
- **Locking, idle, and session actions:** consider these together, last. Agree on
  authentication/PAM, lock-before-sleep, idle timeouts, output power/wake, confirmations, and
  shell-failure behavior before replacing existing owners. Preserve security and suspend/resume
  behavior; visual consistency alone is not a reason to weaken them.

## Retained boundaries

- Sway owns the compositor and graphical session. Noctalia supplies desktop UI inside that session;
  it does not launch Sway or replace the session launcher.
- Preserve Pi working/waiting status, stale/non-agent filtering, and the combined system/user
  failed-unit indicator. Leave the Pi activity producer and protocol unchanged.
- Keep `mb-clipboard`, `mb-screenshot`, `mb-lock-screen`, `mb-exit`, Fuzzel, cliphist, swaylock,
  swayidle, kanshi, and udiskie while their workflows remain. Native clipboard history, locking, and
  idle management stay disabled; session actions retain the existing confirmation/lock flow.
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