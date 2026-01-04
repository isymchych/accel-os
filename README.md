# dotfiles

This repository relies on [chezmoi](https://www.chezmoi.io/) to manage dotfiles.

To bootstrap a new host:

```bash
chezmoi init --source="$HOME/dotfiles/dotfiles" --destination="$HOME"
chezmoi apply
```

Re-run `chezmoi diff` before every apply to catch surprises, and keep host-specific bits in templates or `run_` scripts.

## Orchestration
If `just` is installed:

```bash
just provision
```

## CLI tools I rely on
- `yazi` — file manager (remember to install its `unarchiver` plugin for previews)
- `ripgrep` — fast project search
- `fd` — ergonomic file finder
- `tokei` — code line counts
- `just` — task runner
- `fzf` — fuzzy matcher
- `wget` — HTTP(S) downloads
- `htop` — system monitor
- `gitui` — TUI for git
- `delta` — git diff viewer
- `difftastic` — syntax-aware diffs
- `mergiraf` — semantic merge driver
- `rainfrog` — CLI database client
- `television` - fuzzy file finder / search
- `lazydocker` - TUI for Docker

## Optional CLI tools
- `sad` — structural search/replace, with preview
- `ast-grep` — structural code search/rewrite

## Zsh setup
- Install `starship` for the prompt.
- Install emoji-capable font (e.g., `noto-fonts-emoji`) so glyphs render.
- Add `zsh-completions`, `zsh-autosuggestions`, and `zsh-syntax-highlighting`.
- Tip: `Ctrl+X Ctrl+E` opens the current command in `$EDITOR`.

## Firefox
- The `firefox/` directory stays outside chezmoi (`.chezmoiignore` excludes it) because profile IDs vary per host.
- After installing Firefox, visit `about:profiles`, note the active profile ID, and symlink `firefox/user.js` into that profile (`~/.mozilla/firefox/<profile-id>/user.js`).
- Restart Firefox to load the preferences.

## Emacs
- Dependencies: `git`, `editorconfig`, `aspell`, `ripgrep`.
