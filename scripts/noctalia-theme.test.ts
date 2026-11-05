import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeAvailable =
  process.platform === "linux" && spawnSync("noctalia", ["--version"]).status === 0;

test(
  "native Noctalia templates retain custom palettes and update GTK and new-shell difftastic",
  { skip: nativeAvailable ? false : "requires installed Linux Noctalia" },
  (t) => {
    const home = mkdtempSync(join(tmpdir(), "noctalia-theme-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const config = join(home, ".config");
    const bin = join(home, "bin");
    mkdirSync(config);
    mkdirSync(bin);
    for (const app of ["noctalia", "alacritty", "fuzzel", "newsboat", "zathura"]) {
      cpSync(join(root, "dotfiles/dot_config", app), join(config, app), { recursive: true });
    }
    writeFileSync(
      join(bin, "gsettings"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HOME/gsettings.log"\n',
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      ZDOTDIR: home,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_CACHE_HOME: join(home, "cache"),
    };
    function run(command: string, args: string[]): string {
      const result = spawnSync(command, args, { env, encoding: "utf8" });
      assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    }
    for (const [target, source, originalTheme] of [
      ["alacritty/alacritty.toml", "alacritty/alacritty.toml.tmpl", "solarized_light.toml"],
      ["newsboat/config", "newsboat/config.tmpl", "/colorschemes/solarized-light"],
    ] as const) {
      const args = [
        "--config",
        "/dev/null",
        "--config-format",
        "toml",
        "--source",
        join(root, "dotfiles"),
        "execute-template",
        "--file",
        join(root, "dotfiles/dot_config", source),
      ];
      writeFileSync(join(config, target), run("chezmoi", args));
      const mac = run("chezmoi", ["--override-data", '{"chezmoi":{"os":"darwin"}}', ...args]);
      assert.ok(mac.includes(originalTheme));
      assert.ok(!mac.includes("~/.config/newsboat/theme"));
      assert.ok(!mac.includes("~/.config/alacritty/theme.toml"));
    }
    run("noctalia", ["config", "validate"]);
    // The offline CLI uses [templates.*]; the shell uses [theme.templates.user.*].
    const cliConfig = join(config, "noctalia/offline-templates.txt");
    writeFileSync(
      cliConfig,
      readFileSync(join(config, "noctalia/templates.toml"), "utf8").replaceAll(
        "[theme.templates.user.",
        "[templates.",
      ),
    );
    const palette = join(home, "palette.json");
    writeFileSync(palette, '{"dark":{"primary":"#000000"},"light":{"primary":"#ffffff"}}\n');
    for (const mode of ["dark", "light", "light", "dark"]) {
      run("noctalia", [
        "theme",
        "--theme-json",
        palette,
        "--config",
        cliConfig,
        "--default-mode",
        mode,
        "-o",
        join(home, "unused-palette.json"),
      ]);
      const dark = mode === "dark";
      for (const [output, source] of [
        ["alacritty/theme.toml", `alacritty/solarized_${mode}.toml`],
        ["fuzzel/theme.ini", `fuzzel/${mode}-theme.ini`],
        ["newsboat/theme", `/usr/share/doc/newsboat/contrib/colorschemes/solarized-${mode}`],
        ["zathura/theme", `zathura/${dark ? "nord-dark-theme" : "solarized-light-theme"}`],
      ] as const) {
        const original = source.startsWith("/")
          ? source
          : join(root, "dotfiles/dot_config", source);
        assert.equal(readFileSync(join(config, output), "utf8"), readFileSync(original, "utf8"));
      }
      const gtk = readFileSync(join(config, "gtk-3.0/settings.ini"), "utf8");
      assert.ok(gtk.includes(`gtk-application-prefer-dark-theme=${dark ? 1 : 0}`), gtk);
      assert.ok(gtk.includes("gtk-font-name=Noto Sans 14"));
      assert.equal(
        run("zsh", [
          "-dfc",
          `source "${join(root, "dotfiles/dot_zshenv_tools")}"; print -r -- "$DFT_BACKGROUND"`,
        ]),
        `${mode}\n`,
      );
    }
    assert.equal(
      readFileSync(join(home, "gsettings.log"), "utf8"),
      ["Adwaita-dark", "Adwaita", "Adwaita", "Adwaita-dark"]
        .map((theme) => `set org.gnome.desktop.interface gtk-theme ${theme}\n`)
        .join(""),
    );
  },
);
