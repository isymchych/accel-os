import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    "wl-copy": 'printf "%s\\n" "$@" > "$CAPTURE.args"; cat > "$CAPTURE"; exit "${COMMAND_CODE:-0}"',
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
    assert.match(result.stderr, /Usage:|Unknown template/u);
  }
  await assert.rejects(readFile(fixture.capture), { code: "ENOENT" });
});

test("template copy failures are reported", async (t) => {
  const fixture = await createFixture(t);
  const result = fixture.run(["copy", "task-template.md"], { COMMAND_CODE: "7" });
  assert.equal(result.status, 7, result.stderr);
});
