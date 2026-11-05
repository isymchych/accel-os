# Noctalia migration

Status: initial migration complete. The user completed live deployment and confirmed verification
complete. Follow-up integrations below are recommendations, not approved implementation scope.

## Progress

- [x] Integration prerequisites: verify the native version, widget API, IPC, and session lifecycle.
- [x] Tracked cutover: configuration, indicators, service, shortcuts, and retired app cleanup.
- [x] Repository validation and chezmoi rendering (without applying).
- [x] Live deployment (completed by the user; reported working).
- [x] Desktop acceptance verification (confirmed complete by the user).

Next action: select and authorize a follow-up integration, starting with night light as recommended
below. No acceptance work remains open for the initial migration. Obsolete Waybar, Mako, and SwayOSD
package declarations have been removed; installed host packages were not uninstalled by the agent.

### Verification results

- Installed Noctalia 5.4.1 validates a chezmoi-rendered configuration in an isolated temporary home,
  with no warnings once the local plugin is present. Native plugin lint reports zero errors and zero
  warnings.
- All 18 repository script tests pass, including the independent xterm compatibility test. The xterm
  compatibility check was observed failing before adding the compatibility forms.
- The dedicated mocked-host widget harness and its Lua test dependency were removed by user
  decision. Native plugin lint remains an offline check, not behavioral coverage. Status counting,
  stale/non-agent filtering, refresh behavior, and error handling belong to live acceptance rather
  than offline coverage.
- ShellCheck passes for the xterm shim and launcher command. Sway's configuration validator and
  static systemd unit verification accept the changed configuration. Script TypeScript checks and
  focused lint pass.
- Recursive scoped `chezmoi diff` and `chezmoi apply --dry-run --verbose` were reviewed. Rendering
  preserves executable permissions and removes only the enumerated retired paths. A simulated macOS
  template render ignores Noctalia and produces no Linux cleanup entries; no real macOS apply was
  performed.
- Checked the effective native configuration for single ownership, local-only plugin sources,
  disabled competing features, and the retained session workflow. A mocked click launch preserves
  the literal `*` argument to `systemctl-tui`.
- Full `just check` passes after the user repaired the unrelated Pi extension errors, including
  host-config, completion, formatting, lint, typechecking, and tests.
- No live Noctalia `settings.toml` overrides were present during inspection.

The checks above are offline evidence. The user subsequently completed live deployment, reported
that it runs fine, and confirmed verification complete. Live acceptance is therefore closed on user
confirmation, not on an agent-run test of every desktop interaction. No separate per-item runtime
results were recorded; that evidence distinction does not leave the initial migration open.

### Prerequisite findings

- At initial inspection, native Noctalia 5.4.1-1 was available but not installed. Downloaded
  versioned v5.4.1 documentation to a temporary directory for inspection, without installing or
  starting the shell.
- The v5.4.1 plugin API documents captured asynchronous subprocesses, update intervals, JSON
  decoding, explicit widget visibility, and text/tooltip updates. These support a minimal local
  plugin for Pi and failed-unit status without passing Waybar markup through.
- Right-side bars, named sysmon instances, native launcher/media/audio/brightness IPC, and bar
  toggling are documented. Caffeine uses the compositor's standard Wayland idle-inhibit protocol;
  interaction with retained swayidle was part of the now-completed live acceptance scope.
- Accepted behavior change: `$mod+Shift+Escape` will open the control center's notifications tab
  instead of `makoctl restore`. The user explicitly selected history after the v5.4.1 notification
  IPC check found no documented restore/replay operation.
- Downloaded the Arch Noctalia 5.4.1-1 package to a temporary directory and verified its detached
  signature with the host's trusted pacman keyring. It contains no systemd unit. Temporary
  extraction is for isolated CLI validation, not installation or live shell startup.
- The user subsequently installed Noctalia 5.4.1-1 and ddcutil 3.0.2-1. Use the installed native
  executable for validation from this point; the agent has not installed packages or changed running
  desktop services.
- Selected integration: a local API-24 plugin with three polling widgets (Pi, failed units, Sway
  binding mode), plus native widgets for the other active indicators. Widget subprocesses are
  non-overlapping; query failures show `?` and log an error instead of implying a healthy zero.
- Status collection now lives in Luau rather than separate Bash helpers. Failed units are queried
  through direct asynchronous `systemctl` argument arrays, with each scope counted in Luau. Pi
  status uses native directory/file APIs and sequential asynchronous procfs reads. It retains
  stale/non-agent filtering and the effective-UID temporary-directory fallback. The shared polling
  module handles both filesystem queries and subprocess queries without overlapping refreshes.
- Selected startup: `Type=exec`, session-bound through `sway-session.target`. Override notification
  D-Bus activation to the same unit and conflict with the previous owners. Import the graphical
  environment before starting the session target. Do not declare `BusName` on a second user unit
  while Mako remains installed: static unit verification found duplicate allocation of
  `org.freedesktop.Notifications`. Process startup is not a claim of panel readiness.
- Noctalia's terminal-app launcher expects `TERMINAL -e`. The repository's `xterm` shim now accepts
  no arguments as `open` and `-e command ...` as `run -- command ...`, preserving argument
  boundaries and centralized backend selection. The service sets `TERMINAL=xterm`; no separate
  adapter is needed. Other traditional xterm flags remain unsupported.
- Disable Noctalia lockscreen/logind integration and route its session menu to `mb-exit`, preventing
  native session entry points from bypassing the retained lock/confirmation workflow.
- Enable supported external-monitor brightness through the user-installed ddcutil; keep the existing
  5% brightness floor. No device permission or brightness changes are part of offline validation.
- Retired file paths are listed explicitly in `.chezmoiremove`; deleting sources alone would leave
  stale installed units/configs behind. Keep directory contents and untracked live state outside
  those exact paths intact.
- The agent changed only tracked configuration and did not install packages, change live services,
  or apply the desktop configuration. The user completed deployment and verification separately.

## Outcome and boundaries

Make Noctalia the primary desktop UI inside the existing Sway session. Skip an aesthetic trial: the
user already wants Noctalia. Preserve useful workflows rather than reproduce every Waybar visual
detail.

Agreed constraints:

- Sway owns windows, workspaces, input, keybindings, and the graphical session. Noctalia does not
  launch Sway.
- Manage configuration through Git and chezmoi.
- Preserve Pi-agent status and the combined system/user failed-unit count.
- Use Git and chezmoi for rollback, without a parallel fallback configuration or switching
  framework. Keep the old packages installed until the cutover works.
- Restoring files does not restore running processes: rollback also requires reconciling services or
  logging out and back in.

Completed first-cutover scope (owners shown before and after migration):

| Responsibility                            | Previous owner                                           | Cutover owner                             |
| ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| Bar and system indicators                 | Waybar                                                   | Noctalia                                  |
| Application launcher                      | Fuzzel through `mb-run-app`                              | Noctalia through the same command         |
| Notifications                             | Mako                                                     | Noctalia                                  |
| Volume, brightness, media-key feedback    | SwayOSD                                                  | Noctalia, preserving existing key actions |
| Clipboard                                 | `mb-clipboard`, Fuzzel, cliphist                         | Unchanged                                 |
| Screenshots and annotation                | `mb-screenshot`, grim, slurp, Satty                      | Unchanged                                 |
| Locking and idle policy                   | `mb-lock-screen`, swaylock, swayidle                     | Unchanged                                 |
| Output configuration                      | kanshi                                                   | Unchanged                                 |
| Application light/dark transitions        | darkman and theme scripts                                | Unchanged                                 |
| Night light                               | wlsunset                                                 | Unchanged                                 |
| Session actions                           | `mb-exit`                                                | Unchanged initially                       |
| Authentication and desktop infrastructure | polkit agent, keyring, portals, PipeWire, NetworkManager | Unchanged                                 |

Fuzzel remains required by clipboard, screenshot, and exit menus even after application launching
moves to Noctalia. Do not enable overlapping Noctalia idle, clipboard-history, night-light,
authentication, or application-theme management during this cutover.

## Pre-cutover integration points

- `dotfiles/dot_config/sway/config` launches Waybar through its `bar` block, defines launcher,
  notification, media, and brightness shortcuts, imports the graphical environment, and starts/stops
  `sway-session.target`. It also starts `nm-applet` and `udiskie` directly.
- `dotfiles/dot_config/systemd/user/sway-session.target` pulls Mako, SwayOSD, darkman, clipboard
  watchers, kanshi, swayidle, wlsunset, and the polkit agent into the session.
- `dotfiles/dot_config/waybar/config` defines the existing right-side bar and its actions.
  `executable_pi_agents.sh` and `executable_systemd_failed_units.sh` own the custom status queries.
- Pi activity is produced separately by `ai/pi/extensions/agent-activity/`; the bar reads state
  under the runtime directory's `accel-os/pi-agents`. Leave the producer and its protocol unchanged.
- Declare desktop packages in `dotfiles/.chezmoidata/packages.yaml`; scope Linux-only target paths
  in `dotfiles/.chezmoiignore`.

Planning inspection found a clean working tree and the simplified failed-unit indicator already
tracked. No `noctalia` executable was on PATH. Local package metadata advertised `noctalia` 5.4.1-1;
confirm availability and version at implementation time rather than treating cached metadata as an
installation.

## Delivery sequence

Slices 1–3 are complete. The sequence and acceptance criteria below retain the original cutover
contract for reference; they are not outstanding tasks.

### 1. Resolve integration prerequisites before changing startup

This is a technical feasibility check, not another preference trial.

- Confirm the available native Noctalia version, package contents, configuration schema, IPC, and
  plugin API. Use documentation matching that version; do not mix legacy Quickshell/v4 examples with
  native v5 configuration. Upstream currently documents Arch's `noctalia` package [1].
- Establish the smallest supported integration for the two custom indicators. Prefer built-in
  capabilities where sufficient; otherwise use minimal local plugin widgets. The documented
  `custom_button` is a static label/action widget, not evidence of Waybar JSON compatibility [2].
  Plugin subprocess output capture is documented, but rendering, refresh scheduling, hiding empty
  widgets, and version compatibility still need checking [3].
- Reuse the existing status-query logic. Move it out of the Waybar directory if it remains needed
  after Waybar removal; do not leave Noctalia dependent on a retired app's configuration directory.
  Translate the presentation rather than passing Pango markup or Waybar CSS classes through.
- Check native IPC equivalents for all affected shortcuts, including notification dismiss/history,
  player stop, microphone mute, and the bar toggle. If no equivalent preserves an existing action,
  identify the gap and obtain a decision before dropping it.
- Confirm that Noctalia's idle-inhibition control works with the retained swayidle setup.

Completion: record the selected integration and any remaining decisions in this plan. If either
custom indicator cannot be preserved reasonably, pause the bar replacement rather than silently omit
it. Installation or runtime experiments happen only under subsequent implementation/deployment
authorization.

### 2. Prepare a complete tracked desktop cutover

Depends on the prerequisite checks. Prepare the changes together; do not deploy a half-replaced
notification or OSD stack.

- Add curated configuration under `dotfiles/dot_config/noctalia/`, starting with one `config.toml`
  unless the integration requires more. Use native defaults where they fit. Keep unrelated Noctalia
  features disabled where they would compete with retained owners.
- Preserve workspaces, Sway mode visibility, keyboard layout, clock/calendar, tray, playback and
  microphone status, Bluetooth, power profile, idle inhibition, CPU/RAM/disk/temperature,
  brightness, battery, and access to existing session actions. Map existing click actions before
  removing them. The proposed layout starts on the right if supported; visual differences are
  acceptable. Any functional omission needs a decision.
- Port Pi status: distinguish working and waiting agents; hide when none exist; preserve rejection
  of stale/non-agent process state. Preserve the current roughly three-second refresh.
- Port failed-unit status: count both system and user scopes across all unit types, show only the
  count, hide at zero, and show no tooltip. Preserve the ten-second refresh and left-click command:

  ```sh
  xterm run --class=systemd-manager -- systemctl-tui --scope all --no-log --limit-units '*'
  ```

  Do not reintroduce a custom inspector, right-click action, or a promise of failed-only startup.

- Keep `mb-run-app` as the launcher entry point and preserve its current Sway shortcuts. Replace
  SwayOSD and Mako commands with verified equivalents. Inspect `mb-audio` notification behavior so
  microphone actions do not produce duplicate feedback.
- Propose a repo-managed `noctalia.service`, pulled by `sway-session.target` and stopped with that
  session, consistent with the repository's session-daemon policy. Do not introduce uwsm or change
  the login/session launcher as part of this migration. Confirm environment import precedes startup;
  avoid ordering cycles with `graphical-session.target`. Verify the actual package's readiness
  mechanism before choosing the service type. Upstream's service page describes an experimental unit
  and limits stock Sway support to uwsm, so it is not a drop-in design for this custom session [4].
- Ensure launcher-started applications survive a Noctalia restart. Check tray registration for
  `nm-applet` and `udiskie` on fresh login, not just after manual shell startup.
- Remove Waybar startup and Mako/SwayOSD session dependencies together with their replacements.
  Check other activation paths so they do not reclaim ownership. Remove obsolete tracked
  configuration and hooks once replacements cover their behavior, but retain the old packages
  through live acceptance.
- Add the package to the canonical inventory and Linux-only configuration paths to `.chezmoiignore`.
  Update `docs/linux/README.md` only for new operational instructions.
- Keep curated files authoritative. Noctalia's app-managed `~/.local/state/noctalia/settings.toml`
  overrides tracked TOML [5]; inspect and reconcile conflicting overrides explicitly, preserving
  unrelated state rather than deleting it wholesale.

Completion: tracked configuration is internally consistent and ready for a separately authorized
apply. Check formatting, modified shell scripts with ShellCheck, affected command checks if needed,
`just check-dotfiles`, `git diff --check`, and version-appropriate Noctalia validation. Review
`chezmoi diff` and `chezmoi apply --dry-run --verbose` without applying.

Use native plugin lint for offline widget checks; verify status behavior during live acceptance.
Verify literal `*` argument handling on the click command. Offline checks do not establish GUI
behavior.

### 3. Apply and verify the integrated session

Depends on the tracked cutover and explicit live-deployment authorization.

- Review `chezmoi diff` and `chezmoi apply --dry-run --verbose`, including the exact retired paths
  in `.chezmoiremove`: applying deletes those old configurations. Keep Waybar, Mako, and SwayOSD
  packages installed until live acceptance succeeds. Inspect conflicting Noctalia settings overrides
  before cutover, preserving unrelated state.
- Install the declared dependency, apply the agreed paths, reload user units, and reconcile old/new
  processes. After the approved apply, log out and back in so the new service, D-Bus activation,
  Sway shortcuts, and old-process shutdown take effect together.
- Confirm one bar, one notification daemon, and one OSD owner. Check all affected shortcuts and
  status actions, including locked media-key behavior without weakening screen locking.
- Exercise notifications from `notify-send` and an application, dismissal/history, audio and
  microphone mute, brightness, media controls, tray apps, workspaces, keyboard layout, system
  indicators, and idle inhibition. Check laptop/external-output behavior.
- Check both custom indicators with real state, including that failures open `systemctl-tui`. Do not
  manufacture failed host services merely to test rendering.
- Verify unchanged clipboard, screenshots, lock/suspend/resume, kanshi, darkman, and night light.
  Restart Noctalia: Sway and launcher-started applications must remain usable.
- Log out and back in: Noctalia stops with the old session and starts once in the new one. Inspect
  its journal for startup, plugin, and ownership errors.

Completion: report what was actually verified and any remaining manual checks. After successful
cutover, remove obsolete package declarations only where no retained consumer requires them; package
uninstallation is not implicit.

## Recovery

Recovery uses the pre-cutover Git revision and chezmoi. Restore only migration-owned paths without
overwriting unrelated changes; remove newly deployed paths no longer managed after reversal;
review/apply the restored configuration, reload user units, and stop Noctalia before restarting old
owners or logging in again. Inspect Noctalia overrides if they affect a subsequent reattempt. No
dedicated toggle script, fallback profile, or permanent duplicate stack is planned.

## Follow-up integration recommendations

These are proposed next steps, not accepted replacement decisions or authorization to implement,
apply configuration, change services, or uninstall packages. The initial migration is complete
without them. Recommendations are based on the tracked setup and upstream documentation matching
installed Noctalia 5.4.1; recheck the installed version before implementation.

The aim is to consolidate desktop UI while preserving useful workflows and underlying
infrastructure. Suggested order: night light → polkit → networking UI → unified theming →
clipboard/screenshots if worthwhile → locking, idle, and session actions last. The first three can
be delivered independently; later candidates need the decisions noted below.

### 1. Night light: replace wlsunset

The smallest next integration. Noctalia supports Sway gamma control, scheduled temperature changes,
and a native toggle [6]. The current owner is `dotfiles/dot_config/systemd/user/wlsunset.service`.

Proposed slice: configure manual location and temperatures in the tracked Noctalia configuration,
retire the wlsunset session dependency, and reconcile the running owners during an authorized
deployment. Avoid simultaneous gamma-control owners.

Acceptance proposal: validate configuration, check the native toggle and day/night temperatures on
the available outputs, confirm the schedule, and check ownership after fresh login.

### 2. Authentication dialogs: replace the GNOME polkit agent

Noctalia has a native polkit agent, currently disabled by `shell.polkit_agent = false` [7].
Replacing `polkit-gnome-authentication-agent.service` would make authentication dialogs match the
rest of the shell. This replaces the agent UI, not polkit itself.

Proposed slice: enable the native agent and remove the previous agent's session startup together.
Acceptance proposal: one registered agent after login, successful authentication for actual
privileged desktop actions, and working cancellation and failed-authentication feedback.

### 3. Networking UI: replace nm-applet

`dotfiles/dot_config/sway/config` still starts `nm-applet --indicator`. Noctalia's native network
widget opens the control center's Network tab and provides connection and VPN status [8].

Before retiring the applet, compare the user's Wi-Fi, VPN, secret-prompt, and connection-editing
workflows with native capabilities. Keep NetworkManager and any required authentication helpers.
Acceptance proposal: the needed connection workflows work after fresh login without duplicate tray
UI. Retain the applet if a required workflow is not covered.

### 4. Unified light/dark switching

The current Noctalia configuration pins the shell and app-facing theme dark while darkman switches
application themes. This is a larger everyday consistency opportunity than removing another daemon.
Noctalia offers app-theme templates and a `theme_mode_changed` hook [9, 10].

Recommended direction, pending a decision: let Noctalia own day/night selection and initially reuse
the existing application-specific theme commands through a hook. Preserve the user's chosen themes
for GTK, Alacritty, difftastic, Gemini, Newsboat, Fuzzel, and Zathura rather than requiring
generated palettes. Generated app themes can be considered separately.

Choose one scheduling authority before replacing darkman; do not leave both independently changing
the same applications. The tracked darkman and wlsunset coordinates differ. Noctalia can share one
manual location or explicit schedule between theme switching and night light without IP geolocation
[11]. Confirm the intended location/schedule instead of copying either value blindly.

Acceptance proposal: manual and scheduled light/dark transitions consistently update the shell and
retained applications, survive restart/login, and do not introduce conflicting generated files or
app-managed overrides over chezmoi-owned configuration.

### 5. Clipboard: evaluate before replacing

Native history offers pinning, image actions, and encrypted persistence [7], but
`packages/commands/bin/mb-clipboard.ts` also supplies templates, emoji search, save-to-file,
thumbnails, and custom keyboard actions. Native history is not evidence of feature parity.

Recommendation: retain the existing workflow for now. Before a replacement decision, compare those
features and decide how templates, emoji, saving, and shortcuts would be preserved. Check keyring
availability for persistent encrypted history. If migrating, retire the cliphist watchers as part of
the cutover rather than permanently collecting history twice.

### 6. Screenshots: preserve the command contract

Noctalia supports native region/fullscreen capture, annotation, and piping PNG output into Satty [7,
12]. The existing `dotfiles/bin/executable_mb-screenshot` also supplies focused-window capture,
delays, and output under `~/temp/screenshots`. Native fullscreen selection has different
multi-monitor behavior from the current grim capture.

Recommendation: retain `mb-screenshot` and its Sway shortcuts for now. If native capture is adopted,
preserve the command interface and replace internals only where behavior matches or the user accepts
a change. Compare annotation, focused-window and multi-output capture, delays, file location,
cancellation, and clipboard behavior before retiring grim, slurp, or Satty. Native screenshot
clipboard output requires Noctalia clipboard integration to be enabled [7].

### 7. Locking, idle, and session actions: a separate later phase

Consider `mb-lock-screen`/swaylock, swayidle, and the Fuzzel-backed `mb-exit` menu together.
Noctalia provides native locking, logind lock-before-sleep integration, configurable idle behaviors,
and session actions [7, 13]. Keep the current owners until a separately agreed cutover preserves
their security and confirmation behavior.

Before implementation, settle authentication/PAM behavior, lock-before-sleep ordering, idle
timeouts, output power-off/wake behavior, session confirmations, and what happens if Noctalia
restarts or fails. Acceptance proposals include password/fingerprint behavior as applicable, manual
and idle locking, caffeine, lid-close and explicit suspend/hibernate, resume, multiple outputs,
locked media keys, and logout/relogin. This phase comes last because visual consistency alone does
not justify weakening locking or sleep safety.

### Retain infrastructure and useful standalone owners

- Keep Sway for compositor/session ownership and kanshi for output profiles.
- Keep udiskie until a concrete replacement covers the actual mounting/unmounting workflow.
- Keep the keyring, portals, PipeWire, and NetworkManager. Consolidate their UI where useful rather
  than removing the infrastructure.
- Keep Fuzzel while clipboard, screenshot, or session-menu consumers remain.

## Upstream references

These are research entry points, not implementation contracts. References 1–5 are the original
rolling entry points; references 6–13 match the 5.4.1 follow-up review. Recheck against the
installed package before implementation; documented capabilities are not proof of local runtime
acceptance.

1. Installation: `https://docs.noctalia.dev/noctalia/getting-started/installation/`
2. Custom button: `https://docs.noctalia.dev/noctalia/bar/widgets/custom-button/`
3. Plugin runtime: `https://docs.noctalia.dev/noctalia/plugins/development/runtime-api/`
4. Service integration: `https://docs.noctalia.dev/noctalia/compositor-settings/systemd-service/`
5. Configuration layers: `https://docs.noctalia.dev/noctalia/configuration/`
6. Night light: `https://docs.noctalia.dev/noctalia/v5.4.1/services/night-light/`
7. Shell, polkit, clipboard, screenshots, locking, and session actions:
   `https://docs.noctalia.dev/noctalia/v5.4.1/configuration/shell/`
8. Network widget: `https://docs.noctalia.dev/noctalia/v5.4.1/bar/widgets/network/`
9. Theme-change hooks: `https://docs.noctalia.dev/noctalia/v5.4.1/automation/hooks/`
10. Application theming: `https://docs.noctalia.dev/noctalia/v5.4.1/theming/app-theming/`
11. Shared location and schedule: `https://docs.noctalia.dev/noctalia/v5.4.1/services/location/`
12. Screenshot capture: `https://docs.noctalia.dev/noctalia/v5.4.1/bar/widgets/screenshot/`
13. Idle behaviors: `https://docs.noctalia.dev/noctalia/v5.4.1/services/idle/`