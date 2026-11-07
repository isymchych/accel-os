import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeAvailable =
  process.platform === "linux" && spawnSync("noctalia", ["--version"]).status === 0;

type CommandFixture = {
  run(command: string, args: string[], enabled?: string, fail?: string): SpawnSyncReturns<string>;
  calls(): string[];
};

function commandFixture(t: TestContext): CommandFixture {
  const directory = mkdtempSync(join(tmpdir(), "noctalia-bar-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "calls");
  writeFileSync(log, "");
  writeFileSync(
    join(directory, "noctalia"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_LOG"
if [[ "$*" == "msg config-get bar.right.enabled" ]]; then
  printf '%s\\n' "$TEST_ENABLED"
elif [[ "$*" == "\${TEST_FAIL:-}" ]]; then
  printf '%s\\n' 'IPC failed' >&2
  exit 1
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(directory, "systemctl"),
    "#!/usr/bin/env bash\nprintf '%s\\n' test-session\n",
    { mode: 0o700 },
  );
  return {
    run(command: string, args: string[], enabled = "false", fail = ""): SpawnSyncReturns<string> {
      return spawnSync("bash", [join(root, "dotfiles/bin", `executable_${command}`), ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env["PATH"] ?? ""}`,
          XDG_RUNTIME_DIR: directory,
          TEST_LOG: log,
          TEST_ENABLED: enabled,
          TEST_FAIL: fail,
        },
      });
    },
    calls(): string[] {
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    },
  };
}

for (const [layout, selected, other] of [
  ["top", "default", "right"],
  ["right", "right", "default"],
] as const) {
  test(`selecting ${layout} enables it before disabling the other layout`, (t) => {
    const fixture = commandFixture(t);
    const result = fixture.run("mb-bar-layout", [layout]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fixture.calls(), [
      `msg config-set bar.${selected}.enabled true`,
      `msg config-set bar.${other}.enabled false`,
    ]);
  });
}

for (const [enabled, selected, other] of [
  ["false", "right", "default"],
  ["true", "default", "right"],
] as const) {
  test(`toggle selects ${selected} when right.enabled is ${enabled}`, (t) => {
    const fixture = commandFixture(t);
    const result = fixture.run("mb-bar-layout", ["toggle"], enabled);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fixture.calls(), [
      "msg config-get bar.right.enabled",
      `msg config-set bar.${selected}.enabled true`,
      `msg config-set bar.${other}.enabled false`,
    ]);
  });
}

test("invalid arguments and unreadable layout state cause no configuration writes", (t) => {
  const fixture = commandFixture(t);
  for (const args of [[], ["left"], ["top", "right"]]) {
    assert.notEqual(fixture.run("mb-bar-layout", args).status, 0);
  }
  assert.equal(fixture.run("mb-bar-layout", ["--help"]).status, 0);
  assert.deepEqual(fixture.calls(), []);
  const result = fixture.run("mb-bar-layout", ["toggle"], "unknown");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected bar.right.enabled/u);
  assert.deepEqual(fixture.calls(), ["msg config-get bar.right.enabled"]);
});

test("failed destination activation does not disable the current bar", (t) => {
  const fixture = commandFixture(t);
  const result = fixture.run(
    "mb-bar-layout",
    ["right"],
    "false",
    "msg config-set bar.right.enabled true",
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IPC failed/u);
  assert.deepEqual(fixture.calls(), ["msg config-set bar.right.enabled true"]);
});

test("auto-hide follows the selected bar and keeps independent per-layout state", (t) => {
  const fixture = commandFixture(t);
  for (const enabled of ["false", "true", "false", "true"]) {
    const result = fixture.run("mb-noctalia-bar", [], enabled);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(fixture.calls(), [
    "msg config-get bar.right.enabled",
    "msg bar-show default",
    "msg bar-auto-hide-set on default",
    "msg bar-reserve-toggle default",
    "msg config-get bar.right.enabled",
    "msg bar-show right",
    "msg bar-auto-hide-set on right",
    "msg bar-reserve-toggle right",
    "msg config-get bar.right.enabled",
    "msg bar-show default",
    "msg bar-auto-hide-set off default",
    "msg bar-reserve-toggle default",
    "msg config-get bar.right.enabled",
    "msg bar-show right",
    "msg bar-auto-hide-set off right",
    "msg bar-reserve-toggle right",
  ]);
});

test("switching layouts clears auto-hide bookkeeping reset by native config reloads", (t) => {
  const fixture = commandFixture(t);
  for (const [command, args, enabled] of [
    ["mb-noctalia-bar", [], "false"],
    ["mb-bar-layout", ["right"], "false"],
    ["mb-noctalia-bar", [], "true"],
    ["mb-bar-layout", ["top"], "true"],
    ["mb-noctalia-bar", [], "false"],
  ] as const) {
    const result = fixture.run(command, [...args], enabled);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(
    fixture.calls().filter((call) => call.startsWith("msg bar-auto-hide-set")),
    [
      "msg bar-auto-hide-set on default",
      "msg bar-auto-hide-set on right",
      "msg bar-auto-hide-set on default",
    ],
  );
});

test(
  "native config retains both layouts and honors the persisted selection",
  { skip: nativeAvailable ? false : "requires installed Linux Noctalia" },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "noctalia-bar-config-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const state = join(directory, "noctalia");
    mkdirSync(state);
    const env = {
      ...process.env,
      NOCTALIA_CONFIG_HOME: join(root, "dotfiles/dot_config"),
      NOCTALIA_STATE_HOME: directory,
    };
    for (const selection of [undefined, false, true]) {
      const rightEnabled = selection ?? false;
      if (selection !== undefined) {
        writeFileSync(
          join(state, "settings.toml"),
          `[bar.default]\nenabled = ${!rightEnabled}\n[bar.right]\nenabled = ${rightEnabled}\n`,
        );
      }
      const validation = spawnSync("noctalia", ["config", "validate"], {
        env,
        encoding: "utf8",
      });
      assert.equal(validation.status, 0, validation.stderr);
      const result = spawnSync("noctalia", ["config", "export", "full"], {
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      for (const [name, position, enabled] of [
        ["default", "top", !rightEnabled],
        ["right", "right", rightEnabled],
      ] as const) {
        const section = result.stdout.split(`[bar.${name}]\n`)[1]?.split(/\n\s*\[/u)[0];
        assert.ok(section, `missing ${name} bar`);
        assert.match(section, new RegExp(`^[ \\t]*enabled = ${enabled}$`, "m"));
        assert.match(section, new RegExp(`^[ \\t]*position = "${position}"$`, "m"));
        assert.doesNotMatch(section, /\bpower_profile\b/u);
      }
    }
  },
);
