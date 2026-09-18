# Arch Linux setup

This is the personal installation and maintenance guide for an Accelerando OS
workstation. Package inventories belong in
`dotfiles/.chezmoidata/packages.yaml`; this guide records bootstrap steps,
intentional system choices, manual configuration, and optional software.

## What Accel OS manages

Accel OS configures an Arch Linux host according to the features declared in
`dotfiles/.chezmoidata/hosts.yaml`. Depending on those features, it manages:

- Base, workstation, Sway desktop, and hardware-specific packages.
- The system and user services required by each selected feature.
- Networking through NetworkManager, including unicast DNS without
  `systemd-resolved`.
- Printing, network-printer discovery, and `.local` name resolution through
  CUPS, Avahi, and mDNS.
- Firmware updates and a graphical firmware manager.
- Laptop power management and host-specific battery charge thresholds through
  TLP.
- Bluetooth services and desktop media integration.
- A Sway session with login, audio, portals, notifications, clipboard,
  screenshots, and display management.
- Workstation policy for login sessions, power-button behavior, swap
  preference, and the Linux console.
- Optional host features such as Caps Lock-to-Escape keyboard interception.
- Repository-managed command-line and development tooling.

The canonical declarations are
`dotfiles/.chezmoidata/packages.yaml` for packages and
`dotfiles/.chezmoidata/services.yaml` for services. Run `just doctor` from the
repository to verify that the host matches its declaration and `chezmoi apply`
to repair drift.

### External tools

Tools unavailable from the official repositories or AUR live in the
`external_tools` section of `dotfiles/.chezmoidata/packages.yaml`. Pin each
GitHub release artifact by its HTTPS URL, archive SHA-256, installed binary
name, and binary SHA-256. Chezmoi validates unique binary targets, then
downloads, verifies, and atomically installs missing or drifted binaries in
`~/.local/bin` after package installation; `just doctor` verifies the installed
checksum.

## Install Arch

### Boot and partitioning

- Use GPT.
- When dual-booting, install Windows first and reuse its EFI system partition.
- Mount the EFI system partition at `/boot`.
- Allocate the remaining space to the root filesystem.
- Use `systemd-boot`. This host boots Arch and Windows with systemd-boot; rEFInd
  is not part of the current setup.
- A 512 MiB EFI system partition is sufficient for a non-dual-boot setup.

### Base system

- Use `setfont ter-132b` in the installer when a larger terminal font is useful.
- Generate both `en_GB.UTF-8` and `en_US.UTF-8`; use `en_GB.UTF-8` so weeks
  start on Monday.
- Enable `multilib`, color, and five parallel downloads in `/etc/pacman.conf`.
- Install and configure `sudo`.
- Create the user:

  ```bash
  useradd -m -G wheel,video -s /bin/zsh <username>
  passwd <username>
  ```

  - Install `base-devel`, `git`, `chezmoi`, `fnm`, `just`, `zsh`, and an AUR
    helper such as `yay`.
- NetworkManager owns networking and DNS; do not run a standalone `dnsmasq`
  service.
- Create a swap file when the host needs swap or hibernation.
- Install the appropriate video drivers.

### Intentional system tuning

These settings trade general-purpose defaults for this personal workstation's
performance preferences:

- Kernel parameter `mitigations=off` disables CPU vulnerability mitigations.
  This intentionally accepts increased exposure to CPU side-channel attacks for
  lower mitigation overhead; do not copy it to an untrusted or multi-user host.
- Kernel parameter `random.trust_cpu=on` allows the kernel to trust the CPU
  random-number generator when initializing its entropy pool. This assumes the
  host CPU and firmware are trusted.
- `vm.swappiness=10` biases the kernel away from swapping under ordinary
  pressure. Chezmoi manages it in `/etc/sysctl.d/80-accel-os.conf`.

Add the kernel parameters to the systemd-boot Arch entry. The current host uses:

```text
mitigations=off random.trust_cpu=on
```

### Laptop power management

Laptop hosts use TLP as the sole system power manager. Do not install
`power-profiles-daemon` alongside it. Per-host charge thresholds live in
`dotfiles/.chezmoidata/tlp.yaml`.

## Bootstrap the repository

Install `fnm`, set Zsh as the login shell, then follow the canonical
[repository bootstrap](../../README.md#bootstrap):

```bash
chsh -s /bin/zsh
```

On Arch, `./bootstrap --apply` finishes by running `just doctor`. Repair
managed drift with `chezmoi apply`; the doctor reports remediation for manual
account and keyring configuration.

## Manual setup

### SSH material

Copy the private SSH configuration and certificates from the secure USB drive,
then restrict their permissions:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/key
```

### Keyring

GNOME Keyring and Seahorse provide SSH key storage and management. To unlock the
keyring during greetd login:

1. Add `auth optional pam_gnome_keyring.so` at the end of the `auth` section in
   `/etc/pam.d/greetd`.
2. Add `session optional pam_gnome_keyring.so auto_start` at the end of the
   `session` section.
3. Enable `gcr-ssh-agent` for Git and SSH integration; consult the ArchWiki
   GNOME Keyring page.

`just doctor` verifies both greetd PAM rules, the enabled and active
`gcr-ssh-agent.socket`, and the Sway `SSH_AUTH_SOCK` selection.

### Rootless Docker

Docker and its rootless dependencies are installed for workstation hosts.
Complete Docker's rootless setup manually for the user account.

### Firefox

Install the tracked preferences using the backup and copy workflow in
[`firefox/README.md`](../../firefox/README.md), then configure Cookie Auto
Delete. Browser screen sharing uses `xdg-desktop-portal-wlr`; enable
`chrome://flags/#enable-webrtc-pipewire-capturer` when needed.

### Other applications

- Thunderbird: add accounts and synchronize only the latest 30 days.
- EasyEffects: enable auto-gain for volume normalization.
- Proprietary applications such as Spotify, Slack, Skype, and Google Chrome are
  installed manually.

### Development tools

- Install `git-spr` manually from its upstream repository.
- Install npm-only language servers needed by Emacs:

  ```bash
  npm install --global \
    vscode-langservers-extracted \
    eslint-language-server@2.4.4
  ```

## Hardware-specific setup

### Graphics and video acceleration

- Radeon: install Mesa and Vulkan drivers, including required 32-bit variants;
  use `radeontop` for monitoring.
- Intel: use `intel-gpu-tools` for monitoring.
- Use `libva-utils` and `vdpauinfo` to verify acceleration.
- Install the appropriate VA-API, VDPAU, and GStreamer acceleration packages.
- Adjust Firefox video-acceleration preferences when required.

### Backlight

Keep the user in the `video` group for backlight control. Consult the ArchWiki
Backlight page for hardware-specific configuration.

### Fingerprint scanner

Add the `fingerprint` host feature and run `chezmoi apply` to install `fprintd`
and the lid-state helper. Keep a recovery shell open and back up the PAM files.

In `/etc/pam.d/system-local-login`, replace the direct `pam_fprintd.so` rule
with:

```text
auth [success=1 default=ignore] pam_exec.so quiet /usr/local/libexec/accel-os/laptop-lid-closed
auth sufficient pam_fprintd.so
```

Remove direct `pam_unix.so` and `pam_fprintd.so` rules from
`/etc/pam.d/swaylock`, leaving `auth include login`. Test fingerprint and
password authentication with the lid open, then confirm the closed-lid path
skips the fingerprint reader.

### Hibernation

1. Create a swap file.
2. Add `resume` and `resume_offset` kernel parameters.
3. Add the `resume` hook to `/etc/mkinitcpio.conf`.
4. Run `mkinitcpio -P`.

## Security note

Configure maximum login attempts and lockout duration in
`/etc/security/faillock.conf`; consult the ArchWiki security guidance before
choosing values.