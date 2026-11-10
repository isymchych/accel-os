import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type CommandFixture = {
  run(command: string, args: string[], enabled?: string, fail?: string): SpawnSyncReturns<string>;
  calls(): string[];
};

function commandFixture(t: TestContext): CommandFixture {
  const directory = mkdtempSync(join(tmpdir(), "noctalia-bar-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
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
      return spawnSync(
        "bash",
        [join(root, "dotfiles/dot_config/noctalia/scripts", `executable_${command}`), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}:${process.env["PATH"] ?? ""}`,
            XDG_RUNTIME_DIR: directory,
            TEST_LOG: log,
            TEST_ENABLED: enabled,
            TEST_FAIL: fail,
          },
        },
      );
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
    const result = fixture.run("bar-layout", [layout]);
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
    const result = fixture.run("bar-layout", ["toggle"], enabled);
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
    assert.notEqual(fixture.run("bar-layout", args).status, 0);
  }
  assert.equal(fixture.run("bar-layout", ["--help"]).status, 0);
  assert.deepEqual(fixture.calls(), []);
  const result = fixture.run("bar-layout", ["toggle"], "unknown");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected bar.right.enabled/u);
  assert.deepEqual(fixture.calls(), ["msg config-get bar.right.enabled"]);
});

test("failed destination activation does not disable the current bar", (t) => {
  const fixture = commandFixture(t);
  const result = fixture.run(
    "bar-layout",
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
    const result = fixture.run("bar-toggle", [], enabled);
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
    ["bar-toggle", [], "false"],
    ["bar-layout", ["right"], "false"],
    ["bar-toggle", [], "true"],
    ["bar-layout", ["top"], "true"],
    ["bar-toggle", [], "false"],
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
