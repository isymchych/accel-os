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

function assertQtPalettes(
  config: string,
  primary: string,
  surface: string,
  onSurface: string,
): void {
  for (const version of ["5", "6"]) {
    const palette = readFileSync(join(config, `qt${version}ct/colors/noctalia.conf`), "utf8");
    for (const state of ["active", "inactive", "disabled"]) {
      const line = palette.split("\n").find((entry) => entry.startsWith(`${state}_colors=`));
      assert.ok(line, `Qt${version} palette contains ${state} colors`);
      const colors = line
        .split("=")[1]
        ?.split(",")
        .map((color) => color.trim());
      assert.equal(colors?.length, 22);
      assert.equal(colors[6], onSurface, `${state} text follows the palette`);
      assert.equal(colors[10], surface, `${state} windows follow the palette`);
      assert.equal(colors[21], primary, `${state} accents follow the palette`);
    }
  }
}

test(
  "native Noctalia templates retain custom palettes and update GTK, Qt, Sway, and new-shell difftastic",
  { skip: nativeAvailable ? false : "requires installed Linux Noctalia" },
  (t) => {
    const home = mkdtempSync(join(tmpdir(), "noctalia-theme-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const config = join(home, ".config");
    const bin = join(home, "bin");
    mkdirSync(config);
    mkdirSync(bin);
    for (const app of ["noctalia", "alacritty", "newsboat", "zathura", "sway"]) {
      cpSync(join(root, "dotfiles/dot_config", app), join(config, app), { recursive: true });
    }
    writeFileSync(
      join(bin, "gsettings"),
      '#!/usr/bin/env bash\nif [ "$1" = list-schemas ]; then\n  printf "%s\\n" org.gnome.desktop.interface\nelse\n  printf "%s\\n" "$*" >> "$HOME/gsettings.log"\nfi\n',
      { mode: 0o700 },
    );
    writeFileSync(
      join(bin, "swaymsg"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HOME/swaymsg.log"\n',
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      SWAYSOCK: join(home, "fake-sway.sock"),
      ZDOTDIR: home,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_CACHE_HOME: join(home, "cache"),
    };
    // The shipped GTK hook only selects themes whose directories exist.
    for (const theme of ["adw-gtk3", "adw-gtk3-dark"]) {
      mkdirSync(join(env.XDG_DATA_HOME, "themes", theme), { recursive: true });
    }
    function run(command: string, args: string[]): string {
      const result = spawnSync(command, args, { env, encoding: "utf8" });
      assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    }
    const swayAvailable = spawnSync("sway", ["--version"]).status === 0;
    if (swayAvailable) {
      run("sway", ["--validate", "--config", join(config, "sway/config")]);
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
    const exportedConfig = run("noctalia", ["config", "export", "full"]);
    const themeConfig = exportedConfig.split("\n[theme]\n")[1]?.split("\n[")[0];
    assert.ok(themeConfig, "native config exports theme settings");
    assert.match(themeConfig, /^mode = "auto"$/m, "applications retain automatic appearance");
    assert.match(themeConfig, /^shell_mode = "follow"$/m, "Noctalia follows automatic appearance");
    assert.match(themeConfig, /^custom_palette = "Solarized-Nord"$/m);
    const modeHook = exportedConfig.match(/^\s*theme_mode_changed = \[[^\]]*\]/m);
    assert.ok(modeHook, "native config exports the mode-change hooks");
    assert.match(
      modeHook[0],
      /"noctalia msg templates-apply"/,
      "mode changes force template application so the post-render colors_changed hook runs",
    );
    const templatesConfig = exportedConfig.match(
      /\n\s*\[theme\.templates\]\n([\s\S]*?)(?=\n\s*\[|$)/,
    )?.[1];
    assert.ok(templatesConfig, "native config exports template settings");
    assert.match(templatesConfig, /^\s*enable_builtin_templates = true$/m);
    assert.match(
      templatesConfig,
      /^\s*builtin_ids = \[\s*"gtk3",\s*"gtk4",\s*"sway",\s*"qt"\s*\]$/m,
    );
    assert.match(templatesConfig, /^\s*enable_community_templates = false$/m);
    const colorsChanged = readFileSync(join(config, "noctalia/config.toml"), "utf8").match(
      /^colors_changed = '([^']+)'$/m,
    )?.[1];
    assert.ok(colorsChanged, "Sway reloads after the native templates finish");
    // The offline CLI uses [templates.*]; the shell uses [theme.templates.user.*].
    // It cannot filter --builtin-config, so select the shipped catalog entries here.
    const builtinDir = "/usr/share/noctalia/assets/templates";
    const builtinTemplates = readFileSync(join(builtinDir, "builtin.toml"), "utf8")
      .split(/(?=^\[templates\.)/m)
      .filter((entry) => /^\[templates\.(gtk3|gtk4|sway|qt)\]$/m.test(entry))
      .join("\n")
      .replaceAll('"./', `"${builtinDir}/`)
      .replaceAll("{{ config_dir }}", builtinDir);
    const cliConfig = join(config, "noctalia/offline-templates.txt");
    writeFileSync(
      cliConfig,
      readFileSync(join(config, "noctalia/templates.toml"), "utf8").replaceAll(
        "[theme.templates.user.",
        "[templates.",
      ) +
        "\n" +
        builtinTemplates,
    );
    const palette = join(config, "noctalia/palettes/Solarized-Nord.json");
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
      // The offline CLI does not run the shell's after-apply colors_changed callback.
      run("sh", ["-c", colorsChanged]);
      const dark = mode === "dark";
      const gtkTheme = dark ? "adw-gtk3-dark" : "adw-gtk3";
      const swayTheme = readFileSync(join(config, "sway/noctalia"), "utf8");
      const [primary, surface, onSurface, error] = dark
        ? ["#b58900", "#002b36", "#eee8d5", "#dc322f"]
        : ["#5e81ac", "#eceff4", "#2e3440", "#bf616a"];
      assertQtPalettes(config, primary, surface, onSurface);
      for (const [token, color] of [
        ["primary", primary],
        ["surface", surface],
        ["on_surface", onSurface],
        ["error", error],
      ]) {
        assert.match(swayTheme, new RegExp(`^set \\$${token}\\s+${color}$`, "m"));
      }
      assert.match(
        swayTheme,
        /^client.focused\s+\$primary\s+\$surface\s+\$on_surface\s+\$primary\s+\$primary$/m,
      );
      for (const version of ["3", "4"]) {
        const gtkDir = join(config, `gtk-${version}.0`);
        const css = readFileSync(join(gtkDir, "noctalia.css"), "utf8");
        assert.ok(css.includes(`@define-color accent_bg_color ${primary};`), css);
        assert.ok(css.includes(`@define-color window_bg_color ${surface};`), css);
        assert.ok(css.includes(`@define-color window_fg_color ${onSurface};`), css);
        assert.ok(css.includes(`@define-color error_bg_color ${error};`), css);
        assert.equal(
          readFileSync(join(gtkDir, "gtk.css"), "utf8"),
          '@import url("noctalia.css");\n',
          "native GTK integration remains idempotent",
        );
      }
      for (const [output, source] of [
        ["alacritty/theme.toml", `alacritty/solarized_${mode}.toml`],
        ["newsboat/theme", `/usr/share/doc/newsboat/contrib/colorschemes/solarized-${mode}`],
        ["zathura/theme", `zathura/${dark ? "nord-dark-theme" : "solarized-light-theme"}`],
      ] as const) {
        const original = source.startsWith("/")
          ? source
          : join(root, "dotfiles/dot_config", source);
        assert.equal(readFileSync(join(config, output), "utf8"), readFileSync(original, "utf8"));
      }
      const gtk = readFileSync(join(config, "gtk-3.0/settings.ini"), "utf8");
      assert.ok(gtk.includes(`gtk-theme-name=${gtkTheme}\n`), gtk);
      assert.equal(
        readFileSync(join(home, "gsettings.log"), "utf8")
          .trim()
          .split("\n")
          .filter((line) => line.includes(" gtk-theme "))
          .at(-1),
        `set org.gnome.desktop.interface gtk-theme ${gtkTheme}`,
      );
      assert.ok(gtk.includes(`gtk-application-prefer-dark-theme=${dark ? 1 : 0}`), gtk);
      assert.ok(
        gtk.includes(`gtk-icon-theme-name=${dark ? "Papirus-Dark" : "Papirus-Light"}`),
        gtk,
      );
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
      readFileSync(join(config, "sway/config"), "utf8"),
      readFileSync(join(root, "dotfiles/dot_config/sway/config"), "utf8"),
      "native integration leaves the chezmoi-owned Sway config unchanged",
    );
    assert.match(
      readFileSync(join(config, "sway/config"), "utf8"),
      /^include noctalia\n[\s\S]*?^client\.focused \$primary \$primary \$on_primary \$primary \$primary$/m,
      "the focused tab uses the accent fill after the built-in theme is included",
    );
    assert.equal(readFileSync(join(home, "swaymsg.log"), "utf8"), "reload\n".repeat(4));
    if (swayAvailable) {
      run("sway", ["--validate", "--config", join(config, "sway/config")]);
    }
    const settingsLog = readFileSync(join(home, "gsettings.log"), "utf8").trim().split("\n");
    assert.deepEqual(
      settingsLog.filter((line) => line.includes(" icon-theme ")),
      ["Papirus-Dark", "Papirus-Light", "Papirus-Light", "Papirus-Dark"].map(
        (icons) => `set org.gnome.desktop.interface icon-theme ${icons}`,
      ),
    );
  },
);

test(
  "Qt appearance modifiers select native palettes without changing other QSettings entries",
  { skip: nativeAvailable ? false : "requires installed Linux Noctalia" },
  (t) => {
    const home = mkdtempSync(join(tmpdir(), "qt-appearance-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const args = [
      "--config",
      "/dev/null",
      "--config-format",
      "toml",
      "--source",
      join(root, "dotfiles"),
      "--destination",
      home,
      "--persistent-state",
      join(home, "chezmoistate.boltdb"),
    ];
    function run(extra: string[]): string {
      const result = spawnSync("chezmoi", [...args, ...extra], { encoding: "utf8" });
      assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    }
    const geometry = String.raw`geometry=@ByteArray(\x1\xd9\xd0\xcb\0\x3\0\0)`;
    for (const version of ["5", "6"]) {
      const dir = join(home, `.config/qt${version}ct`);
      const target = join(dir, `qt${version}ct.conf`);
      mkdirSync(dir, { recursive: true });
      const preserved = `[Fonts]\ngeneral="Noto Sans,14,-1,5,50,0,0,0,0,0"\n[SettingsWindow]\n${geometry}\n[Other]\nstyle=untouched\n`;
      writeFileSync(
        target,
        (version === "5"
          ? "[Appearance]\nstyle=Windows\ncustom_palette=false\ncolor_scheme_path=/old\nicon_theme=Papirus\n"
          : "") + preserved,
      );
      run(["apply", target]);
      const settings = readFileSync(target, "utf8");
      assert.ok(settings.includes(preserved), settings);
      assert.equal(settings.includes("icon_theme=Papirus\n"), version === "5", settings);
      assert.match(settings, /^style=Fusion$/m);
      assert.match(settings, /^custom_palette=true$/m);
      assert.ok(
        settings.includes(`color_scheme_path=${join(dir, "colors/noctalia.conf")}\n`),
        settings,
      );
      run(["apply", target]);
      assert.equal(readFileSync(target, "utf8"), settings, "reapplying is idempotent");
      rmSync(target);
      run(["apply", target]);
      assert.match(readFileSync(target, "utf8"), /^custom_palette=true$/m);
    }
    const mac = run([
      "--override-data",
      '{"chezmoi":{"os":"darwin"}}',
      "managed",
      "--path-style",
      "relative",
    ]);
    assert.doesNotMatch(mac, /^\.config\/qt[56]ct(?:\/|$)/m);
  },
);
