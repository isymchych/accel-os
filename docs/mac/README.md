# Setting up
* Install brew
* Fonts:
    brew tap homebrew/cask-fonts
    brew install font-noto-sans, font-jetbrains-mono-nerd-font, font-dejavu
    brew install --cask font-iosevka-nerd-font
* ITerm 2:
  * brew tap homebrew/cask-versions
  * brew install --cask iterm2-beta
  * Preferences -> General/Preferences -> Check "Load preferences from a custom folder or URL" and point it at `~/.config/iterm2`
* brew install git git-delta chezmoi zsh zsh-autosuggestions zsh-syntax-highlighting zsh-completions starship coreutils
* Clone accel-os
* `chezmoi init --source="$HOME/accel-os/dotfiles" && chezmoi apply`
* Use zsh as a shell `chsh -s /bin/zsh`
* CLI tools
    brew install aspell editorconfig fd gitui htop jq just yazi fnm ripgrep tokei wget
* kdiff3 - diff tool
    brew install --cask kdiff3
* Install Owly - prevent Mac from sleeping in 15 minutes
* LinearMouse - disable mouse acceleration
    brew install --cask linearmouse --no-quarantine
* Rectangle - windows management
    brew install --cask rectangle
* Emacs https://github.com/d12frosted/homebrew-emacs-plus
    brew tap d12frosted/emacs-plus
    brew install libgccjit
    brew install emacs-plus --with-modern-purple-flat-icon --with-native-comp
    ln -s /opt/homebrew/opt/emacs-plus@28/Emacs.app /Applications
* optional git-credentials-manager-core - for passwordless auth
    brew tap microsoft/git
    brew cask install git-credential-manager-core
* sad - code search and replace
    brew install ms-jpq/sad/sad
* Stretchly - break time reminder
    brew install --cask stretchly
* Install Telegram
* Karabiner elements - remap keys
    brew install karabiner-elements

# Settings
* Trackpad -> enable "Tap to click"
* Map caps lock to control
* Make ctrl-c etc work https://apple.stackexchange.com/a/170671
* Exclude projects folder from the Spotlight index to prevent high CPU usage


# Dev tools
* brew install yaml-language-server
* brew install typescript-language-server
* brew install vscode-langservers-extracted
