# Installation steps

## Linux & Windows
In case of dual-booting install Windows first.
It will create an `EFI` partition.
During Arch installation mount it as `/efi` and use `reFind` boot manager.

## Partitioning
* Partition table: `gpt`
* 2 partitions
  * (if not dual-booting) create EFI system partition as `/boot`  - 512Mb
  * `/ (root)` - rest
* use `systemd-boot` boot manager

## Install Arch
* to make terminal font larger type `setfont ter-132b`
* locale en_GB.UTF-8 cause week starts from Monday not from Sunday like in en_US.UTF-8 (but generate both locales, just in case)
* in /etc/systemd/logind.conf
  * set KillUserProcesses=yes to kill user processes on logout
  * set HandlePowerKey=suspend
  * ?? set HandleLidSwitch=lock
* in /etc/pacman.conf
  * enable multilib
  * enable color output
  * enable parallel downloads (5)
* add kernel parameters: mitigations=off random.trust_cpu=on

* create/configure Swapfile if needed
* set vm.swappiness=10

* if SSD install util-linux; enable fstrim.timer
* start/enable systemd-timesyncd
* install networkmanager, enable/start NetworkManager.service
* install dnsmasq, enable/start it
* if laptop, install tlp and enable service - good preferences by default

* install & configure sudo
* create user, set password
```
# useradd -m -G wheel,video -s /bin/zsh <username>
# passwd <username>
```

* To change linux console font
  * install terminus-font
  * add `FONT=ter124n` to `/etc/vconsole.conf` and restart systemd-vconsole-setup.service
    * `24` is font size, `n` means normal <https://gist.github.com/danielcbaldwin/0eb3def2478150b32ad27280f8a937fb>

## Install basic cli and configs
* install pacman -S --needed base-devel git go vim just
* install yay
* install openssh, chezmoi, rustup, sccache, lld
* install zsh, zsh-completions, zsh-autosuggestions, zsh-syntax-highlighting, starship, ttf-nerd-fonts-symbols, powerline-fonts
* install udisks2 to mount usb drives
* htop
* zip
* man-db
* tmux
* tree
* ntfs-3g
* dosfstools, mtools - for fat32
* upower
* downgrade - allows to downgrade packages
* reflector - rate pacman mirrors
* hunspell, en_GB
* use usb drive to copy ssh config & certificates, fix permissions:
```
$ chmod 700 ~/.ssh
$ chmod 600 ~/.ssh/key
```
* clone dotfiles from github
* `chezmoi init --source="$HOME/dotfiles/dotfiles" --destination="$HOME"`
* `chezmoi apply` (run with `--dry-run` first on a fresh host)
* switch user to zsh `chsh -s /bin/zsh`
* install pipewire pipewire-pulse

## GUI
* install video drivers
 * Radeon: install mesa, lib32-mesa, vulkan-radeon, lib32-vulkan-radeon
 * radeontop - to monitor radeon graphics card
 * intel-gpu-tools - to monitor intel graphics card
* install greetd
 * enable `greetd.service`
 * copy docs/linux/run-sway.sh into /usr/local/bin/
 * Update `/etc/greetd/config.toml`: `command = "agreety --cmd run-sway.sh"`
 * `systemctl edit greetd` and change service type to `idle` to prevent systemd logs overwriting login prompt
 * ? configure autologin

## Environment
* sway
* ttf-dejavu
* noto-fonts, noto-fonts-emoji - Noto fonts
* swaylock
* swayidle
* waybar, otf-font-awesome, ttf-jetbrains-mono-nerd
* xorg-xwayland
* kanshi - automatically switch display configurations
* wl-clipboard - cli tools for interacting with clipboard
* cliphist - clipboard manager
* mako - notification daemon; enable and start mako service
* darkman - enable dark mode on sunset
* wev - monitor keypresses, like xev
* wtype - xdotool type for wayland
* libnotify
* light - to control backlight
* gnome-keyring, seahorse - GUI for storing & unlocking SSH keys
  * To automatically unlock gnome-keyring on login, edit `/etc/pam.d/greetd`:
  * Add `auth optional pam_gnome_keyring.so` at the end of the `auth` section
  * Add `session optional pam_gnome_keyring.so auto_start` at the end of the `session` section
  * For git/ssh integration enable the gcr-ssh-agent <https://wiki.archlinux.org/title/GNOME/Keyring>
* polkit-gnome - allow apps to ask for root password if needed
* xorg-xrdb
* xorg-xhost
* wmname
* qt5ct - qt5 configuration tool
* terminal - configs invoke the `~/bin/xterm` shim
  * alacritty
  * OR ghostty
  * OR wezterm
* wlsunset - adjust display color temperature at night
* udiskie - automounter for removable media
* network-manager-applet - network manager applet
* nm-connection-editor, networkmanager-openvpn, libnma-gtk4 - network manager ui
* pavucontrol - pulseaudio utils
* wofi - command runner
* gsimplecal - calendar
* grim - capture the screenshot
* slurp - select the part of the screen
* satty - simple drawing on top of images
* wf-recorder - record the screen
* kooha - simple GUI for recording the screen
* yazi - file manager
* p7zip - 7z/zip cli archiver for yazi
* translate-shell - Google Translate
* playerctl - CLI to control MPRIS-compatible players (including browsers)
* rofimoji - pick & insert emoji
* android-file-transfer - MTP client for android to browse & send files
* systemctl-tui - TUI for systemctl services & their logs

* gnome-themes-extra - needed for dark theme
* adwaita, adwaita-qt5 (gtk default) - GTK3 theme
* papirus-icon-theme - icon theme
* ttc-iosevka, ttf-iosevka-nerd, ttf-iosevkaterm-nerd - Iosevka Term mono font

<!-- * nordic - dark GTK3 theme -->
<!-- * ttf-jetbrains-mono - JetBrains Mono font -->
<!-- * ttf-droid - Droid font -->
<!-- * ttf-fira-mono - Fira Mono font -->

* interception-caps2esc - bind CapsLock to Escape while pressing and to Control while holding
  * copy `caps-to-esc-and-ctrl.yaml` into `/etc/interception/udevmon.d/`
  * `systemctl enable --now udevmon.service`

* if bluetooth
 <!-- * install bluez bluez-utils -->
 * start and enable bluetooth service
 * start and enable mpris-proxy user service

* trash-cli
* libsecret
* xdg-utils
* imagemagick
* xdg-desktop-portal-xapp
* xdg-desktop-portal-wlr - for screensharing
  * enable pipewire user service
  * enable chrome://flags/#enable-webrtc-pipewire-capturer

* run `rustup default stable`
* clone typed-v and install mb-binutils
* for backlight, add user to video group; https://wiki.archlinux.org/index.php/Backlight#ACPI

## Apps
* Firefox
  * install config from dotfiles
  * tweak settings of Cookie Auto Delete
* Thunderbird
  * add accounts
  * configure to synchronise only latest 30 days
* Chromium
* easyeffects - enable "auto gain" plugin, for volume normalisation
* transmission-gtk
* telegram-desktop
* spotify
* newsboat - rss reader
* safeeyes - break reminder
* file-roller - GUI archive manager
* gparted
* wdisplays-git - display configuration GUI
* zathura, zathura-pdf-mupdf - pdf viewer
* mpv, mpv-mpris - video player
* imv - image viewer
* yt-dlp - download videos from video hosting services
* gnome-calculator - calculator
* syncthing - file sync
* iftop - CLI network connections monitor

* slack
* skype
* google chrome


## Dev tools
* emacs-wayland, aspell, aspell-en
* ripgrep - search in files
* jq - filter json
* fd - better "find"
* tokei - count lines of code
* kdiff3
* delta - better git diffs
* `git-spr` <https://github.com/ejoffe/spr> - stacked pull requests for GitHub
* `github-cli` - CLI for interacting with GitHub
* watchexec - run commands on file change
* cargo-outdated
* cargo-release - helpers for release management
* rust-analyzer
* Node.js
* npm
* editorconfig-core-c
* install typescript typescript-language-server eslint-language-server@2.4.4 (needed for emacs-lsp)
  * npm i -g vscode-langservers-extracted
* android-tools, android-udev
* uv - fast python package & project manager
* Rootless docker


## Configure hardware acceleration
* video acceleration
  * libva-utils for `vainfo`
  * vdpauinfo
  * VA-API support: libva-mesa-driver, lib32-libva-mesa-driver
  * VDPAU support: mesa-vdpau, lib32-mesa-vdpau
* Gstreamer support - gstreamer-vaapi
* tweak video acceleration settings in firefox config

# Fingerprint scanner
* install fprintd
* add these lines to `/etc/pam.d/{system-local-login,swaylock,sudo,su}`
```
# the first line is only needed for swaylock, to be able to auth with password
auth            sufficient      pam_unix.so try_first_pass likeauth nullok
auth            sufficient      pam_fprintd.so
```

# Firmware update service
* install fwupd, gnome-firmware

## Hibernation
* create swapfile
* add `resume` and `resume_offset` kernel parameters
* add `resume` hook into `/etc/mkinitcpio.conf` and run `# mkinitcpio -P`

## Printing
* install cups, avahi, nss-mdns
* edit `/etc/nsswitch.conf` and change the hosts line to include `mdns_minimal [NOTFOUND=return]` before resolve and dns  [source](https://wiki.archlinux.org/title/avahi#Hostname_resolution)
* disable `systemd-resolved` service due to conflict with avahi
* enable and start cups service

## Tips
* configure max login attempts and login block time in `/etc/security/faillock.conf` [more info](https://wiki.archlinux.org/title/security#Lock_out_user_after_three_failed_login_attempts)
