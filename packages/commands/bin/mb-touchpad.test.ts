import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { parseTouchpadEnabled } from "./mb-touchpad.ts";

function fixture(
  t: test.TestContext,
  swayScript: string,
): {
  dir: string;
  run: (...args: string[]) => SpawnSyncReturns<string>;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "mb-touchpad-test-"));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  writeFileSync(path.join(dir, "swaymsg"), `#!${process.execPath}\n${swayScript}`, { mode: 0o700 });
  writeFileSync(path.join(dir, "logger"), `#!${process.execPath}\nprocess.stdin.resume();\n`, {
    mode: 0o700,
  });

  return {
    dir,
    run: (...args) =>
      spawnSync(
        process.execPath,
        [new URL("./mb-touchpad.ts", import.meta.url).pathname, ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${dir}${path.delimiter}${process.env["PATH"] ?? ""}`,
            CALLS: path.join(dir, "calls"),
          },
          timeout: 5000,
        },
      ),
  };
}

test("CLI performs actions, reads resulting state, and ignores notification failure", (t) => {
  const { dir, run } = fixture(
    t,
    `
const fs = require("node:fs");
fs.appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "-t") console.log(JSON.stringify([{type: "touchpad", libinput: {send_events: "disabled"}}]));
`,
  );

  writeFileSync(
    path.join(dir, "notify-send"),
    `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(1);
`,
    { mode: 0o700 },
  );

  const result = run("-n", "toggle");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Touchpad is disabled\n");
  assert.equal(
    readFileSync(path.join(dir, "calls"), "utf8"),
    [
      JSON.stringify(["input", "type:touchpad", "events", "toggle", "enabled", "disabled"]),
      JSON.stringify(["-t", "get_inputs", "-r"]),
      JSON.stringify(["-u", "low", "Touchpad is disabled"]),
      "",
    ].join("\n"),
  );
});

test("CLI validates arguments and reports Sway failures", (t) => {
  const { run } = fixture(
    t,
    `
process.stderr.write("sway failed\\n");
process.exit(7);
`,
  );

  assert.equal(run("--help").status, 0);
  assert.notEqual(run("invalid").status, 0);
  assert.notEqual(run("status", "extra").status, 0);

  const failure = run("status");

  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /sway failed/u);
  assert.match(failure.stderr, /swaymsg exited with status 7/u);
});

test("parseTouchpadEnabled accepts provider-owned extra fields", () => {
  assert.equal(
    parseTouchpadEnabled(
      JSON.stringify([
        { type: "keyboard", identifier: "keyboard" },
        {
          type: "touchpad",
          identifier: "touchpad",
          libinput: { send_events: "enabled", tap: "enabled" },
        },
      ]),
    ),
    true,
  );
});

test("parseTouchpadEnabled reports disabled state", () => {
  assert.equal(
    parseTouchpadEnabled(
      JSON.stringify([{ type: "touchpad", libinput: { send_events: "disabled" } }]),
    ),
    false,
  );
});

test("parseTouchpadEnabled treats non-enabled provider states as disabled", () => {
  assert.equal(
    parseTouchpadEnabled(
      JSON.stringify([
        { type: "touchpad", libinput: { send_events: "disabled_on_external_mouse" } },
      ]),
    ),
    false,
  );
});

test("parseTouchpadEnabled rejects missing touchpads", () => {
  assert.throws(
    () => parseTouchpadEnabled(JSON.stringify([{ type: "keyboard" }])),
    /Could not find a touchpad/u,
  );
});
