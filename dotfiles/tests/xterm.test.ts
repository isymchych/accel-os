import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shim = path.join(root, "dotfiles/bin/executable_xterm");

test("xterm compatibility forms preserve arguments and retain strict explicit commands", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xterm-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(
    path.join(dir, "kitty"),
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
  const invoke = (args: string[]): SpawnSyncReturns<string> =>
    spawnSync("bash", [shim, ...args], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}` },
      encoding: "utf8",
      timeout: 5000,
    });
  const command = [
    "printf",
    "%s",
    "two words",
    "*",
    "",
    "$(touch should-not-exist)",
    "--class=literal",
  ];
  for (const args of [[], ["open"]]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
  }
  for (const args of [
    ["-e", ...command],
    ["run", "--", ...command],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), command);
  }
  const options = invoke(["run", "--cwd", "/two words", "--class=example", "--", ...command]);
  assert.equal(options.status, 0, options.stderr);
  assert.deepEqual(JSON.parse(options.stdout), [
    "--directory",
    "/two words",
    "--class",
    "example",
    ...command,
  ]);
  for (const args of [
    ["-e"],
    ["-hold"],
    ["-class", "example"],
    ["run", "printf"],
    ["run", "--"],
    ["open", "--"],
    ["open", "unexpected"],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage:/);
  }
});
