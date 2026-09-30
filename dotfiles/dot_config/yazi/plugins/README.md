# Vendored Yazi plugins

These plugins are checked in so chezmoi can deploy them without downloading
dependencies:

- `git.yazi/main.lua` and `git.yazi/types.lua`
- `smart-enter.yazi/main.lua`
- `toggle-pane.yazi/main.lua`

All listed files are unmodified copies from <https://github.com/yazi-rs/plugins>,
commit `33dde2872cee694543fe37619628a9005921c52c`. The upstream MIT license is
included in `LICENSE`.

Keep personal settings in `../init.lua` and `../keymap.toml`, rather than
editing vendored code. Smart-enter is configured with `open_multi = true` to
retain selected-file opening; `T` toggles the preview pane.
Git status indicators use upstream defaults and require both the setup call
in `../init.lua` and the file/directory fetchers in `../yazi.toml`.

## Updating

1. Retrieve upstream into a temporary directory and choose an exact commit.
   Check each plugin's README and `@since` annotation against the installed
   `yazi --version`; review source changes for behavior or API changes.
2. Copy the listed plugin files and upstream `LICENSE` into this directory.
   Update the commit above and describe any intentional local modifications.
3. Compare the copies byte-for-byte with that commit. Run `luac -p` on
   `../init.lua` and all plugin Lua files, then run `git diff --check`.
4. Before deployment, review `chezmoi diff --include=files "$HOME/.config/yazi"`
   and `chezmoi apply --dry-run --verbose --include=files "$HOME/.config/yazi"`.
   Preserve any live-only customizations before applying.
5. After an explicitly approved deployment, verify in Yazi that `l` and Enter
   enter directories and open selected files, and that `T` hides and restores
   the preview pane. In a Git repository, check status indicators for staged,
   unstaged, untracked, and ignored files, directory status propagation, and
   refresh after external Git changes. Check responsiveness in a large
   repository and verify that non-repository directories remain unaffected.

The empty `../package.toml` does not manage these copies. Update the repository
source rather than running package upgrades against the deployed configuration.
