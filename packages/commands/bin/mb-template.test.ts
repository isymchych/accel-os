import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("./mb-template.ts", import.meta.url));

type TemplateFixture = {
  capture: string;
  run(args?: string[], extraEnv?: NodeJS.ProcessEnv): SpawnSyncReturns<string>;
};

async function createFixture(t: test.TestContext): Promise<TemplateFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "mb-template-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const capture = path.join(root, "capture");
  const env = {
    ...process.env,
    HOME: root,
    PATH: `${root}:${process.env["PATH"] ?? ""}`,
    CAPTURE: capture,
  };

  for (const [name, body] of Object.entries({
    "wl-copy":
      'printf "%s\\n" "$@" > "$CAPTURE.args"; cat > "$CAPTURE"; printf "%s" "${COMMAND_STDERR:-}" >&2; exit "${COMMAND_CODE:-0}"',
    logger: 'cat >> "$CAPTURE.journal"; printf "\\n" >> "$CAPTURE.journal"',
  })) {
    const executable = path.join(root, name);
    await writeFile(executable, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    await chmod(executable, 0o755);
  }

  return {
    capture,
    run: (args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> =>
      spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
        env: { ...env, ...extraEnv },
        encoding: "utf8",
        timeout: 5000,
      }),
  };
}

test("list exposes the tracked templates to the launcher", async (t) => {
  const fixture = await createFixture(t);
  const result = fixture.run(["list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "issue-template.md\nshrug-emoticon.md\ntask-template.md\ntz-template.md\n",
  );
});

test("copy copies the canonical file verbatim as plain text", async (t) => {
  const fixture = await createFixture(t);
  const result = fixture.run(["copy", "task-template.md"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    await readFile(fixture.capture),
    await readFile(new URL("../assets/mb-template/templates/task-template.md", import.meta.url)),
  );
  assert.equal(await readFile(`${fixture.capture}.args`, "utf8"), "--type\ntext/plain\n");
});

test("invalid selections and arguments cannot invoke clipboard tools", async (t) => {
  const fixture = await createFixture(t);
  for (const args of [
    [],
    ["copy", "../package.json"],
    ["copy", "missing.md"],
    ["copy"],
    ["copy", "task-template.md", "extra"],
    ["list", "extra"],
    ["unknown"],
  ]) {
    const result = fixture.run(args);
    assert.equal(result.status, 1, `${JSON.stringify(args)}: ${result.stderr}`);
    assert.match(result.stdout + result.stderr, /USAGE|Usage:|Unknown template/u);
  }
  await assert.rejects(readFile(fixture.capture), { code: "ENOENT" });
});

test("template copy failures are reported", async (t) => {
  const fixture = await createFixture(t);
  const result = fixture.run(["copy", "task-template.md"], {
    COMMAND_CODE: "7",
    COMMAND_STDERR: "clipboard failed",
  });

  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stderr, /clipboard failed/u);
  assert.match(await readFile(`${fixture.capture}.journal`, "utf8"), /clipboard failed/u);
});

test("a missing clipboard command fails without printing to stdout", async (t) => {
  const fixture = await createFixture(t);
  const emptyPath = `${fixture.capture}-empty-path`;

  await mkdir(emptyPath);
  await writeFile(
    path.join(emptyPath, "logger"),
    `#!${process.execPath}\nprocess.stdin.resume();\n`,
    { mode: 0o755 },
  );

  const result = fixture.run(["copy", "task-template.md"], { PATH: emptyPath });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /wl-copy/u);
});
