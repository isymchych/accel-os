import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test(
  "Qt appearance modifiers preserve unrelated QSettings entries and are idempotent",
  { skip: process.platform !== "linux" && "Qt appearance modifiers are Linux-only" },
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
