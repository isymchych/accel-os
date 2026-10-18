# macOS setup

The macOS support tier covers the portable Accel OS core: shell configuration, the pinned Node
runtime, `ACCEL_OS`, `ai`, and portable repository commands. The Arch package, service, Sway, and
`just doctor` automation does not apply.

## Bootstrap

Install [Homebrew](https://brew.sh/), then make it available in the current shell. Use the path
matching the host:

```bash
# Apple Silicon
eval "$(/opt/homebrew/bin/brew shellenv)"

# Intel
eval "$(/usr/local/bin/brew shellenv)"
```

Install the portable prerequisites:

```bash
brew install git chezmoi fnm just zsh
```

Follow the canonical [repository bootstrap](../../README.md#bootstrap), then set Zsh as the login
shell:

```bash
chsh -s /bin/zsh
```

Run `./bootstrap` to inspect the Chezmoi changes and `./bootstrap --apply` to apply them, install
the pinned Node runtime and repository dependencies, and verify the portable configuration. Start a
new login shell afterward so `ACCEL_OS`, `~/bin`, and the managed shell configuration are available.

## Optional workstation setup

### Shell and CLI tools

```bash
brew install \
  aspell \
  coreutils \
  editorconfig \
  fd \
  git-delta \
  htop \
  jq \
  just \
  lazygit \
  neovim \
  ripgrep \
  starship \
  tokei \
  wget \
  yazi \
  zsh-autosuggestions \
  zsh-completions \
  zsh-syntax-highlighting
```

### Fonts

```bash
brew install --cask \
  font-dejavu-sans \
  font-iosevka-nerd-font \
  font-jetbrains-mono-nerd-font \
  font-noto-sans
```

### Applications

- iTerm2: install the desired release, then configure it to load preferences from
  `~/.config/iterm2`.
- KDiff3: `brew install --cask kdiff3`
- LinearMouse: `brew install --cask linearmouse --no-quarantine`
- Rectangle: `brew install --cask rectangle`
- Stretchly: `brew install --cask stretchly`
- Karabiner-Elements: `brew install --cask karabiner-elements`
- Install Owly to prevent the Mac from sleeping during long-running work.
- Install Telegram when needed.

### Emacs

Use the `d12frosted/homebrew-emacs-plus` tap and select the current Emacs version and build options
intentionally rather than relying on the historical version-specific command previously recorded
here.

### Other development tools

- `brew install ms-jpq/sad/sad`
- Install a Git credential manager when passwordless HTTPS authentication is needed.

## Settings

- Trackpad -> enable "Tap to click"
- Map caps lock to control
- Make ctrl-c etc work https://apple.stackexchange.com/a/170671
- Exclude projects folder from the Spotlight index to prevent high CPU usage

## Language servers

```bash
brew install yaml-language-server
npm install --global typescript-language-server vscode-langservers-extracted
```