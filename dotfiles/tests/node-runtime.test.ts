import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const shim = path.join(root, "dotfiles/bin/executable_accel-node");

async function fixture(context: test.TestContext): Promise<{
  repository: string;
  caller: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "accel-node-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, "repo with spaces");
  const caller = path.join(directory, "caller");
  await mkdir(path.join(repository, "node_modules/.bin"), { recursive: true });
  await mkdir(caller);
  return { repository, caller };
}

test("accel-node children use the repo-managed runtime", async (context) => {
  const { repository, caller } = await fixture(context);
  await symlink(process.execPath, path.join(repository, "node_modules/.bin/node"));
  const result = spawnSync(
    "bash",
    [
      shim,
      "-e",
      `require("node:child_process").execFileSync("node", ["-p", "process.execPath"], { stdio: "inherit" });`,
    ],
    {
      cwd: caller,
      env: { ...process.env, ACCEL_OS: repository, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), process.execPath);
});

test("accel-node fails clearly instead of falling back to a system runtime", async (context) => {
  const { repository, caller } = await fixture(context);
  const result = spawnSync("bash", [shim, "--version"], {
    cwd: caller,
    env: { ...process.env, ACCEL_OS: repository },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm install --frozen-lockfile/);
});

test("bootstrap inspection does not install dependencies or apply dotfiles", async (context) => {
  const { repository, caller } = await fixture(context);
  const bin = path.join(repository, "tools");
  const home = path.join(repository, "home");
  const log = path.join(repository, "calls");
  await mkdir(bin);
  await mkdir(home);
  for (const command of ["chezmoi", "pnpm", "just", "zsh"]) {
    await writeFile(
      path.join(bin, command),
      `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(command)}, ...process.argv.slice(2)]) + "\\n");
`,
      { mode: 0o755 },
    );
  }
  const result = spawnSync(path.join(root, "bootstrap"), [], {
    cwd: caller,
    env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [
      ["chezmoi", `--source=${root}/dotfiles`, `--destination=${home}`, "diff"],
      [
        "chezmoi",
        `--source=${root}/dotfiles`,
        `--destination=${home}`,
        "apply",
        "--dry-run",
        "--verbose",
      ],
    ],
  );
});
