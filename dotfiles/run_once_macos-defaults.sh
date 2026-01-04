#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  exit 0
fi

# Finder visibility tweaks
defaults write com.apple.finder AppleShowAllFiles YES
defaults write com.apple.finder ShowPathbar -bool true
defaults write com.apple.finder ShowStatusBar -bool true

# Disable "natural" scrolling
defaults write NSGlobalDomain com.apple.swipescrolldirection -bool false

# Dock behaviour
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0
defaults write com.apple.dock expose-animation-duration -float 0.1

# Terminal defaults
defaults write com.apple.terminal StringEncodings -array 4

# Safari developer tools
defaults write com.apple.Safari IncludeDevelopMenu -bool true
defaults write com.apple.Safari WebKitDeveloperExtrasEnabledPreferenceKey -bool true
defaults write com.apple.Safari "com.apple.Safari.ContentPageGroupIdentifier.WebKit2DeveloperExtrasEnabled" -bool true
defaults write NSGlobalDomain WebKitDeveloperExtras -bool true

# Mission Control
defaults write com.apple.dock mru-spaces -bool false

# Disable mouse acceleration
defaults write .GlobalPreferences com.apple.mouse.scaling -1

# Font smoothing
defaults write -g CGFontRenderingFontSmoothingDisabled -bool NO
defaults -currentHost write -globalDomain AppleFontSmoothing -int 2

# Keyboard repeat rate
defaults write -g InitialKeyRepeat -int 15
defaults write -g KeyRepeat -int 2

killall Finder || true
killall Dock || true

echo "macOS defaults applied"
