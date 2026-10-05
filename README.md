# Accelerando OS

Personal workstation configuration managed with
[chezmoi](https://www.chezmoi.io/). The primary target is Arch Linux with Sway;
macOS notes are also available.

## Repository layout

- `dotfiles/` — Chezmoi source tree for `$HOME`
- `scripts/` — repository checks, formatting, and host verification
- `packages/commands/` — Node TypeScript implementations for installed `mb-*` commands
- `firefox/` — Firefox preferences and profile installation instructions
- `docs/linux/` — Arch Linux installation and host setup
- `docs/mac/` — macOS setup notes
- `ai/` — coding-agent configuration and automation

## Platform support

Arch Linux and macOS share the portable shell and repository tooling. Arch also
includes managed packages and services, host verification, and the Sway desktop
configuration.

## Bootstrap

Install `git`, `chezmoi`, `fnm`, and `zsh` using the platform guide, then clone
this repository at the path used by the default `ACCEL_OS` value:

```bash
git clone <repository-url> "$HOME/accel-os"
cd "$HOME/accel-os"
./bootstrap
```

The first run displays the pending changes and validates a dry-run without
changing the home directory. Review the output, then apply and verify the
configuration:

```bash
./bootstrap --apply
exec zsh -l
```

`./bootstrap --apply` installs repository dependencies with the pinned Node
runtime, runs `chezmoi doctor` and `just check`, and runs `just doctor` on Arch
Linux.

The bootstrap derives `ACCEL_OS` from its repository location for the duration
of the run. The shell configuration defaults it to `$HOME/accel-os`; configure
the environment before starting Zsh if the repository lives elsewhere. Arch
package installation and managed services are derived from host features in
`dotfiles/.chezmoidata/`.

## Guides

- [Arch Linux setup](docs/linux/README.md)
- [macOS setup](docs/mac/README.md)
- [Firefox preferences](firefox/README.md)
- [AI workspace development](ai/workspace/README.md)
- [Retargeting a Git SPR stack](docs/git-spr-retargeting.md)