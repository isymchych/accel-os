# Noctalia migration

Status: initial migration complete. Follow-up integrations 1–4 are deployed; live acceptance is
partial. On November 5, 2026, the user authorized runtime reconciliation and fixes for appearance,
the retired polkit failure, CPU temperature, and brightness verification. VPN work is explicitly
postponed. Other follow-ups remain recommendations, not approved implementation scope. See the
current runtime results below rather than treating the historical offline results as deployment
evidence.

## Progress

- [x] Integration prerequisites: verify the native version, widget API, IPC, and session lifecycle.
- [x] Tracked cutover: configuration, indicators, service, shortcuts, and retired app cleanup.
- [x] Repository validation and chezmoi rendering (without applying).
- [x] Live deployment (completed by the user; reported working).
- [x] Desktop acceptance verification (confirmed complete by the user).

Next action: complete interactive native authentication/cancellation, Emacs theme-following, night
light, fresh-login, and scheduled appearance-transition acceptance. Production VPN authentication is
deferred by user decision; keep its old UI package installed. No acceptance work remains open for
the initial migration. Obsolete Waybar, Mako, SwayOSD, wlsunset, darkman, and polkit-gnome package
declarations have been removed; installed host packages were not uninstalled by the agent.

### Leftover cleanup checklist

This checklist records cleanup state, not permission to apply configuration, change services, or
uninstall packages. Recheck the host before acting; do not repeat completed cleanup.

| Package ID     | Cleanup readiness                                                         | Last observed host state (November 5, 2026) |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| `waybar`       | Initial cutover verified; eligible for removal when explicitly authorized | Installed                                   |
| `mako`         | Initial cutover verified; no package removal needed if still absent       | Not installed under this package ID         |
| `swayosd`      | Initial cutover verified; no package removal needed if still absent       | Not installed under this package ID         |
| `wlsunset`     | Keep until follow-up 1 is deployed and live-verified                      | Installed                                   |
| `polkit-gnome` | Keep until follow-up 2 is deployed and live-verified                      | Installed                                   |

- [ ] Complete the remaining live acceptance for deployed follow-ups 1, 2, and 4. Follow-up 3's
      production VPN acceptance is postponed; do not remove its retained applet package.
- [ ] With explicit uninstall authorization, recheck installed package IDs and retained consumers,
      review the package manager's removal transaction, and remove only eligible obsolete packages.
      Record which packages were actually removed; do not infer removal from inventory edits.
- [ ] During an authorized apply, use `dotfiles/.chezmoiremove` as the exact retired-file list.
      Review scoped `chezmoi diff` and `chezmoi apply --dry-run --verbose`; preserve unlisted
      directory contents and unrelated user state.

Keep `fuzzel`, `cliphist`, grim/slurp/Satty, `swaylock`, `swayidle`, `kanshi`, and `udiskie`: their
retained workflows have not been replaced. Keep the installed darkman package until follow-up 4's
remaining acceptance passes; it must stay stopped. Keep `network-manager-applet` (`nm-applet`) until
follow-up 3 passes production VPN authentication without the applet running. Keep polkit itself, the
keyring, portals, PipeWire, and NetworkManager; only their explicitly replaced UI components are
cleanup candidates.

### Verification results

#### Current runtime results — November 5, 2026

- Chezmoi reports no deployment drift. The follow-up configuration and generated theme outputs are
  present. The agent applied only the additional Sway and CPU-temperature corrections below.
- Removed Sway's competing `exec_always` GTK theme assignment and reloaded Sway. Stopped darkman and
  restarted the main appearance portal after checking that no active portal sessions or PipeWire
  capture streams were present. Darkman remains inactive after theme changes and portal reads; no
  masks or activation overrides were added.
- Noctalia was restarted successfully. Its native polkit agent registered. Cleared only the retired
  GNOME agent's failed state after confirming the replacement; both system and user failed-unit
  lists are empty. Interactive authentication and cancellation remain untested.
- Removed the fixed hwmon override in favor of native automatic selection. Noctalia detected
  `coretemp`, label `Package id 0`, at 41°C. This avoids depending on boot-specific hwmon numbers.
- Selected light then dark through native IPC. For both modes, shell mode, GTK theme and
  color-scheme preferences, standardized appearance portal reads, and generated Alacritty, Fuzzel,
  Newsboat, Zathura, and difftastic files agreed. Portal `SettingChanged` signals were observed.
  Restored `auto` afterward; Noctalia persisted that selection in its settings override. No running
  Emacs process was present, so no session was terminated or live Emacs behavior claimed.
- Changed laptop and external-monitor brightness through native IPC and restored their original
  values. Independent sysfs and DDC/CI readback confirmed the changes and restoration. The laptop
  output was inactive, so its visual behavior remains unverified. The logind session-resolution
  warning persists but did not block either backend; service startup was not redesigned.
- Native configuration validation, the native template test, Sway validation, and whitespace checks
  pass. These do not establish fresh-login behavior, interactive authentication, running-app theme
  reloads, Emacs behavior, or a scheduled transition.
- Networking/VPN changes were left untouched. Production VPN attempts earlier in the session failed
  to obtain secrets; investigation and acceptance are postponed. Keep the applet package and do not
  change credential storage.

#### Initial migration evidence

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

Follow-ups 1–4 have tracked implementation and deployment; remaining acceptance is recorded in the
current runtime results above. Later steps remain recommendations, not accepted replacement
decisions. VPN work is postponed, and package removal still requires separate authorization. The
initial migration is complete without these follow-ups. Recommendations are based on the tracked
setup and upstream documentation matching installed Noctalia 5.4.1; recheck the installed version
before implementation.

The aim is to consolidate desktop UI while preserving useful workflows and underlying
infrastructure. Suggested order: night light → polkit → networking UI → unified theming →
clipboard/screenshots if worthwhile → locking, idle, and session actions last. The first three can
be delivered independently; later candidates need the decisions noted below.

### 1. Night light: replace wlsunset

Status: deployed. Native night-light startup reports a 4000 K nighttime target; output, toggle,
schedule, and fresh-login acceptance remain pending.

Noctalia now has night light enabled with the user-supplied manual coordinates
`50.470666901477415, 30.514520179219673`, online location lookup disabled, and astronomical
sunrise/sunset scheduling. Temperatures preserve wlsunset's defaults: 6500 K daytime and 4000 K
nighttime. Native scheduling uses Noctalia's one-hour transition centered on sunrise/sunset [6].
Darkman remains unchanged; its separate location is deferred to follow-up 4.

The wlsunset session dependency, tracked unit, and package declaration are retired. Its deployed
unit is explicitly listed in `.chezmoiremove`. Noctalia conflicts with and is ordered after the old
unit to prevent simultaneous gamma-control owners during startup.

Live acceptance remains pending: check the native toggle and day/night temperatures on available
outputs, confirm the schedule, and check ownership after fresh login.

### 2. Authentication dialogs: replace the GNOME polkit agent

Status: deployed. Native agent registration is verified and the retired unit's failure cleared;
interactive authentication, cancellation, and failed-authentication feedback remain pending.

Noctalia's native agent is enabled with `shell.polkit_agent = true` [7]. The GNOME agent's session
dependency, tracked unit, and package declaration are retired; `.chezmoiremove` removes its deployed
unit. Noctalia conflicts with and is ordered after the old agent. This replaces the authentication
UI, not polkit itself; the installed Noctalia package depends on polkit.

Live acceptance remains pending: one registered agent after login, successful authentication for
actual privileged desktop actions, and working cancellation and failed-authentication feedback.

The following deployment instructions remain as reference; both slices are now deployed. For any
further authorized apply, review scoped chezmoi diff/dry-run before applying, stop the old services
before their unit files are removed, apply the tracked configuration and unit changes, reload user
units, then restart Noctalia or log out and back in. Removing session dependencies alone does not
stop already-running services. Do not uninstall the old packages as part of deployment unless
separately requested. Inspect Noctalia state overrides before applying; preserve unrelated state.

Offline verification passed: `just check-dotfiles`, native validation of chezmoi-rendered Noctalia
configuration in an isolated home, static user-unit verification, and Git whitespace checks. Scoped
chezmoi diff and apply dry-run show only the intended configuration/unit changes and two
retired-unit deletions. Chezmoi archive warned that its config template has changed; no chezmoi
reinitialization was performed.

### 3. Networking UI: replace nm-applet

Status: deployed; production VPN authentication failed to obtain secrets. The user postponed VPN
investigation and acceptance. Keep `network-manager-applet` installed and credential storage
unchanged.

The bar now includes Noctalia's native network widget, with icon-only network and VPN status. Its
default left-click opens the control center's Network tab [8]. The Sway startup command for
`nm-applet --indicator` is removed. Production VPN (`kipish_prod`) is to use Noctalia's native VPN
controls, not a terminal wrapper. The user's manually invoked development OpenVPN/TOTP script
remains unchanged; no saved connections, credentials, or authentication-storage settings are
changed.

Keep NetworkManager, `networkmanager-openvpn`, `nm-connection-editor`, the keyring, and the
installed `network-manager-applet` package until production authentication is verified. The applet
declaration remains in the package inventory pending that check; it is not a permanent second UI.

The configuration is deployed; the following remains guidance for any further authorized apply.
Review scoped chezmoi diff/dry-run and any Noctalia state overrides, apply the configuration, then
log out and back in or explicitly reconcile the running applet and Noctalia. Removing an autostart
line does not stop an existing applet.

Live acceptance remains pending: with nm-applet absent, connect/disconnect the production VPN
through Noctalia, verify credentials and cancellation, test the needed Wi-Fi and wired workflows,
and confirm advanced editing still opens with `nm-connection-editor`. Check a fresh login for no
duplicate network tray UI and confirm the development script still works independently. The
versioned FAQ warns about applet-managed VPN secrets; if authentication fails, investigate before
changing credential storage or removing the applet package. No system-wide password storage or
terminal-based VPN workflow is authorized by this change.

Offline verification passed: `just check-dotfiles`, Sway configuration validation, native validation
of the chezmoi-rendered Noctalia configuration in an isolated home, and Git whitespace checks.
Scoped chezmoi diff/apply dry-run were reviewed; the Noctalia dry-run also includes the pending
night-light and polkit configuration from follow-ups 1 and 2. Existing live Noctalia state contains
only `config_version` and `lockscreen_widgets`, with no network or bar overrides. Chezmoi archive
warned that its config template has changed; no reinitialization or live apply was performed.

### 4. Unified light/dark switching

Status: deployed with authorized runtime reconciliation. Manual light/dark propagation through the
shell, GTK, portal, and generated application files is verified; darkman is stopped. Fresh-login,
Emacs, running-application reload, and scheduled-transition acceptance remain pending.

The user selected native Noctalia user templates instead of a custom dispatcher, and removed Gemini
from theme integration. Use the existing per-app palettes as template inputs [10, 16]. No
`mb-theme`, custom locking/queuing, service masks, or D-Bus activation overrides are retained.
Installed darkman activation remains a deployment concern, not a completed migration; package
removal still requires separate authorization.

Outcome: Noctalia is the single light/dark authority for the shell and applications. Preserve the
existing application palettes and commands rather than introducing generated palettes. Keep
night-light temperatures independent of application appearance, but use the same confirmed manual
location and astronomical schedule. Do not change coordinates or enable online location lookup.

Planned configuration uses `theme.mode = "auto"`, `theme.shell_mode = "follow"`, and
`theme.sync_color_scheme = true` [14]. Built-in and community app templates remain disabled. Manual
light/dark selection goes through Noctalia; selecting `auto` returns to the schedule. No new
shortcut or bar widget is required.

#### Baseline dependencies and retained constraints

- Before this cutover, `dotfiles/dot_config/systemd/user/sway-session.target` started darkman. The
  installed package also provides D-Bus activation for both its own API and its Settings portal
  backend. Removing the session dependency alone is not proof that darkman cannot return.
- Before this cutover, `dotfiles/dot_config/xdg-desktop-portal/sway-portals.conf` selected darkman
  for Settings. The installed GTK portal declares Settings support; use it for appearance while
  retaining the existing wlr ScreenCast/Screenshot routing and other portal choices.
- Before this cutover, `dotfiles/dot_config/emacs/lisp/mb-ui.el` used darkman on Linux and auto-dark
  on macOS. Installed auto-dark version `20260313.2356` already reads the appearance portal and
  subscribes to changes on Linux. Reuse it with `mb-light-theme` and `mb-dark-theme` (currently Doom
  One Light/Doom One); preserve macOS behavior and avoid requiring an Emacs server.
- Native user templates select the existing Alacritty Solarized, Fuzzel, Newsboat Solarized, and
  Zathura Solarized Light/Nord Dark files. Application configs include Noctalia's rendered theme
  files; non-Linux Alacritty and Newsboat defaults remain unchanged. A template renders the curated
  GTK 3 settings and sets the Adwaita GTK theme through `post_hook`. Noctalia alone writes the
  desktop `color-scheme` preference. Another template writes difftastic's background setting for new
  Zsh processes. Retire the paired script directories' known files, including Gemini hooks; preserve
  unlisted user files.
- Preserve theme-change feedback without continuing to label it as coming from darkman. Do not
  promise that existing difftastic shell variables or every running application reload immediately;
  distinguish persisted configuration from live application behavior.

#### A. Resolve the integration prerequisites

Verify the installed Noctalia version and matching template behavior before deployment:

- Use native `input_path_modes` to select fixed palettes without recoloring them. Use `post_hook`
  only for the GTK theme preference. Noctalia owns template application and hook lifecycle [16]; no
  external dispatcher or startup query is needed. Keep theme-change feedback in the documented
  `theme_mode_changed` hook [9].
- Confirm the GTK Settings provider maps the GNOME preference to the standardized appearance portal
  and emits `SettingChanged`. Verify auto-dark's initial read and subscription against the installed
  package, including Emacs startup before/after the shell and absence of a session bus. Do not
  switch live portal ownership during this prerequisite without deployment authorization.
- Render the actual user templates through the installed offline engine in a temporary home. Compare
  outputs to the original palette files, verify GTK preference writes and new-shell difftastic
  settings, and leave GUI reload/startup behavior to separately authorized acceptance.

Completion: a supported startup/change path and portal/Emacs integration are established from local
source, installed APIs, and isolated checks where feasible. Record remaining live checks explicitly.
If evidence contradicts this direction, pause the affected implementation and resolve the blocker
instead of adding a new scheduling authority or bespoke appearance protocol.

#### B. Prepare one coherent tracked cutover

Depends on A. Prepare these changes together; do not deploy a shell-only switch while applications
still depend on darkman:

- Configure Noctalia's schedule, shared shell/app mode, preference synchronization, and user
  templates. Keep Git/chezmoi authoritative; inspect state overrides without deleting unrelated
  state.
- Put user template entries in `dotfiles/dot_config/noctalia/templates.toml`. Preserve selected
  palettes and unrelated app settings; only the existing curated GTK settings and dedicated theme
  outputs are generated. Remove the obsolete dispatcher and paired scripts.
- Route Settings through GTK and replace Linux's Emacs darkman integration with auto-dark. Keep
  initialization and change listening safe in supported GUI/terminal startup paths and leave the
  macOS appearance mechanism unchanged.
- Remove darkman from the session target and canonical package inventory, retire its tracked config,
  and update Linux-only ignores and exact `.chezmoiremove` entries as needed. Check remaining
  consumers and activation paths rather than relying on uninstalling the package to establish single
  ownership.
- Update operational documentation only where instructions change. Do not alter the already prepared
  follow-ups 1–3, locking/idle, clipboard, screenshots, or unrelated user changes.

Completion: the tracked configuration is internally consistent and ready to deploy. Run ShellCheck
for modified Bash scripts, native template checks in a temporary home, and Emacs checks through
`./scripts/check-emacs` (including actual module loading, not copied definitions). Protect
meaningful startup regressions with focused tests where existing checks are insufficient. Run
`just check-dotfiles`, relevant command checks if that workspace changes, native validation of the
isolated rendered Noctalia configuration, and `git diff --check`. Review scoped `chezmoi diff` and
`chezmoi apply --dry-run --verbose`, including simulated non-Linux ignores. These checks do not
establish live appearance propagation.

Offline results (before deployment):

- Installed Noctalia 5.4.1 accepts the isolated configuration. The native template test renders the
  actual user entries through the offline CLI, adapting only its table prefix, and compares
  Alacritty, Fuzzel, Newsboat, and Zathura outputs byte-for-byte with the selected existing
  palettes. It also checks repeated mode applications, GTK settings/theme writes, and difftastic in
  new Zsh processes. Non-Linux Alacritty and Newsboat defaults are verified by simulated macOS
  rendering.
- The earlier private-session GTK portal check returned standard appearance values 1/2 and emitted
  `SettingChanged`. Emacs tests load the actual UI module and installed auto-dark with a mocked
  portal boundary, covering initial dark/light reads, subsequent changes, and absent/unavailable
  session buses. Neither check establishes the deployed desktop's behavior.
- Full `just check`, Zsh syntax, and ShellCheck for the generated shell fragment pass. Scoped
  chezmoi diff and apply dry-run were reviewed; removals enumerate only the retired darkman config
  and known paired scripts. The preview also contains the existing follow-ups 1–3 changes in the
  shared Noctalia config/session target; they were not altered by this work. Simulated macOS ignores
  exclude Noctalia and produce no cleanup entries.
- At the offline preparation stage, no configuration was applied, no live desktop services were
  reconciled, and no packages were removed. Subsequent deployment and authorized runtime
  reconciliation are recorded above; remaining acceptance includes fresh login, actual app reloads,
  scheduled transitions, and real macOS verification if needed. No packages have been removed.

#### C. Deploy and verify the complete appearance flow

Runtime reconciliation was authorized and completed on November 5, 2026; the current runtime results
above identify verified outcomes and remaining acceptance. For any further authorized deployment
work, review the scoped diff/dry-run and theme-related Noctalia state overrides, apply the complete
cutover, stop darkman, reconcile user units and portal processes, and restart affected Emacs
sessions or explicitly disable their old listener. Prefer a fresh login for final acceptance. Do not
restart active portal consumers blindly during screencasts. Keep the old package installed until
acceptance; package uninstallation requires its own request.

Acceptance:

- Select light, dark, then auto through Noctalia. Shell appearance, GNOME preference, portal `Read`
  results and `SettingChanged` signals [15], Emacs, and retained application configurations agree.
  Verify the application's effective theme where it supports live reload and verify new launches
  otherwise.
- Startup/login renders app themes even without a mode transition. A Noctalia restart does not leave
  themes stale. Verify rapid opposite selections through the native template pipeline; there is no
  custom serialization. Failures must be visible rather than reported as successful.
- Confirm auto uses the existing manual location and observe a scheduled transition; manual
  switching alone does not establish timer behavior. Record scheduled verification separately if it
  is not yet observable.
- Emacs started before or after Noctalia reads the current appearance and follows subsequent
  changes; supported no-session-bus startup remains usable. Existing macOS configuration is
  preserved, with any unavailable host verification disclosed.
- Darkman remains stopped after login and after portal/Emacs use despite the package remaining
  installed. No competing preference writer or conflicting theme/template override remains.

Recovery uses the same scoped Git/chezmoi workflow as the initial migration: restore the previous
Noctalia settings, app includes, paired scripts, darkman dependency/config, portal routing, and
Emacs listener together. Remove only migration-owned generated theme outputs; reconcile processes or
relogin so only the restored owner runs. Do not create a permanent fallback stack.

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
rolling entry points; references 6–14 and 16 match the 5.4.1 follow-up review, and reference 15
defines the appearance portal contract. Recheck versioned references against the installed package
before implementation; documented capabilities are not proof of local runtime acceptance.

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
14. Theme mode, shell mode, and desktop preference:
    `https://docs.noctalia.dev/noctalia/v5.4.1/theming/`
15. Appearance portal reads and change signals:
    `https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html`
16. User template inputs, modes, and hook lifecycle:
    `https://docs.noctalia.dev/noctalia/v5.4.1/theming/templates/`