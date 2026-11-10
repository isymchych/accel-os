import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import {
  prepareArtifact,
  publishArtifact,
  readArtifact,
  type Artifact,
} from "../../launcher/artifacts.ts";
import { WorkspaceSupervisor } from "../../launcher/supervisor.ts";
import { initializeState } from "../../scripts/setup-state.ts";

const workspace = resolve(import.meta.dirname, "../..");
const execute = promisify(execFile);

async function sourceFixture(
  context: test.TestContext,
): Promise<{ source: string; state: string }> {
  const directory = await mkdtemp(join(tmpdir(), "workspace-reload-"));
  const source = join(directory, "source/ai/workspace");
  const state = join(directory, "state");
  await mkdir(source, { recursive: true });
  context.after(async () => rm(directory, { recursive: true, force: true }));
  return { source, state };
}

async function fixture(context: test.TestContext): Promise<{
  source: string;
  state: string;
  initial: Artifact;
  compile: (config: string, output: string) => Promise<void>;
  emit: (candidate: Artifact, label?: string) => Promise<void>;
}> {
  const { source, state } = await sourceFixture(context);
  const root = resolve(source, "../..");
  for (const path of ["server", "launcher", "contracts", "scripts"]) {
    await cp(join(workspace, path), join(source, path), { recursive: true });
  }
  for (const path of [
    "package.json",
    "tsconfig.base.json",
    ".editorconfig",
    ".oxfmtrc.json",
    ".oxlintrc.json",
  ]) {
    await cp(resolve(workspace, "../..", path), join(root, path));
  }
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: "@accel-os/workspace",
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        check: "node tests/reload-command.ts check",
        build: "node tests/reload-command.ts build",
      },
    }),
  );
  await mkdir(join(source, "tests"));
  await cp(
    join(workspace, "tests/integration/fixtures/reload-command.ts"),
    join(source, "tests/reload-command.ts"),
  );
  await symlink(resolve(workspace, "../../node_modules"), join(root, "node_modules"), "dir");
  await symlink(resolve(workspace, "node_modules"), join(source, "node_modules"), "dir");
  await initializeState(source, state);
  async function compile(config: string, output: string): Promise<void> {
    await execute(resolve(workspace, "../../node_modules/.bin/tsc"), [
      "--project",
      join(source, config),
      "--outDir",
      output,
    ]);
  }
  async function build(candidate: Artifact, label = "old"): Promise<void> {
    await compile("server/tsconfig.api-build.json", candidate.directory);
    await mkdir(join(candidate.directory, "dist"));
    await writeFile(join(candidate.directory, "dist/index.html"), `<main>${label}</main>`);
  }
  const initial = await prepareArtifact(state);
  await build(initial);
  await publishArtifact(state, initial);
  return { source, state, initial, compile, emit: build };
}

async function waitForCheck(state: string): Promise<number> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      const pid = Number(await readFile(join(state, "check.pid"), "utf8"));
      if (pid > 0) return pid;
    } catch {
      // The check command has not written its readiness marker yet.
    }
    await delay(20);
  }
  return assert.fail("The check command must start.");
}

test("a full build refreshes the saved workspace dependency link", async (context) => {
  const setup = await sourceFixture(context);
  await mkdir(join(setup.source, "node_modules"));
  await initializeState(setup.source, setup.state);
  const dependencies = join(setup.state, "node_modules");
  await unlink(dependencies);
  await symlink(resolve(workspace, "../../node_modules"), dependencies, "dir");
  await initializeState(setup.source, setup.state);
  assert.equal(await readlink(dependencies), join(setup.source, "node_modules"));
  await initializeState(setup.source, setup.state);
  assert.equal(await readlink(dependencies), join(setup.source, "node_modules"));
});

test("startup rejects invalid ports", async (context) => {
  const setup = await fixture(context);
  await setup.compile("launcher/tsconfig.build.json", join(setup.state, "owner"));
  for (const port of ["", "0", "65536", "1.5", "-1", "NaN"]) {
    await assert.rejects(
      execute(process.execPath, [join(setup.source, "scripts/start.ts")], {
        cwd: setup.state,
        env: { ...process.env, WORKSPACE_STATE_DIR: setup.state, WORKSPACE_PORT: port },
      }),
      /Workspace startup failed\./,
    );
  }
});

test("reload activates built UI/API together and keeps its supervisor", async (context) => {
  const setup = await fixture(context);
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  const supervisorId = supervisor.status().ownerId;
  const origin = `http://127.0.0.1:${supervisor.port}`;
  const apiPath = join(setup.source, "server/app/api.ts");
  await writeFile(
    apiPath,
    (await readFile(apiPath, "utf8")).replace(
      "context.json({ echo: message })",
      'context.json({ echo: "new:" + message })',
    ),
  );
  async function diagnostic(): Promise<unknown> {
    return (
      await fetch(`${origin}/api/diagnostic`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ message: "hello" }),
      })
    ).json();
  }

  assert.deepEqual(await diagnostic(), { echo: "hello" });
  assert.match(await (await fetch(origin)).text(), /old/);
  const response = await fetch(`${origin}/api/reload`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ requestId: "reload-1" }),
  });
  assert.equal(response.status, 202);
  await supervisor.waitForReload();
  assert.equal(supervisor.status().phase, "succeeded");
  assert.equal(supervisor.status().ownerId, supervisorId);
  assert.notEqual(supervisor.status().savedVersion, setup.initial.id);
  assert.equal(supervisor.status().servingVersion, supervisor.status().savedVersion);
  assert.match(await (await fetch(origin)).text(), /new/);
  assert.deepEqual(await diagnostic(), { echo: "new:hello" });
});

test("repeating a completed request ID does not repeat checks or builds", async (context) => {
  const setup = await fixture(context);
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  assert.equal(supervisor.reload("repeat").accepted, true);
  await supervisor.waitForReload();
  assert.equal(supervisor.status().phase, "succeeded");
  const completed = supervisor.status();
  assert.equal(supervisor.reload("repeat").accepted, true);
  await supervisor.waitForReload();
  assert.deepEqual(supervisor.status(), completed);
  assert.equal(await readFile(join(setup.state, "commands"), "utf8"), "check\nbuild\n");
});

test("repeated reloads remove superseded output without replacing launcher code", async (context) => {
  const setup = await fixture(context);
  await setup.compile("launcher/tsconfig.build.json", join(setup.state, "owner"));
  const launcherPath = join(setup.state, "owner/launcher/supervisor.js");
  const savedLauncher = await readFile(launcherPath);
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  let previousVersion = setup.initial.id;
  for (const requestId of ["reload-1", "reload-2", "reload-3"]) {
    supervisor.reload(requestId);
    await supervisor.waitForReload();
    assert.equal(supervisor.status().phase, "succeeded");
    const saved = await readArtifact(setup.state);
    assert.notEqual(saved.id, previousVersion);
    assert.equal(saved.id, supervisor.status().savedVersion);
    previousVersion = saved.id;
    const entries = await readdir(setup.state);
    assert.equal(entries.filter((name) => name === "a" || name === "b").length, 1);
    assert.equal(entries.includes("current.next"), false);
  }
  assert.deepEqual(await readFile(launcherPath), savedLauncher);
});

test("restart uses saved compiled UI/API and launcher despite invalid source edits", async (context) => {
  const setup = await fixture(context);
  await setup.compile("launcher/tsconfig.build.json", join(setup.state, "owner"));
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  supervisor.reload("before-restart");
  await supervisor.waitForReload();
  assert.equal(supervisor.status().phase, "succeeded");
  await supervisor.close();

  // Startup and the running application must use built implementation, not edited source.
  for (const path of [
    "server/app/api.ts",
    "server/app/main.ts",
    "launcher/main.ts",
    "launcher/supervisor.ts",
    "launcher/artifacts.ts",
    "scripts/setup-state.ts",
  ]) {
    await writeFile(join(setup.source, path), "invalid source");
  }
  const child = spawn(process.execPath, [join(setup.source, "scripts/start.ts")], {
    cwd: setup.state,
    env: {
      ...process.env,
      WORKSPACE_STATE_DIR: setup.state,
      WORKSPACE_PORT: ` ${supervisor.port}e0 `,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  context.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  });
  const output: unknown[] = await once(child.stdout, "data", {
    signal: AbortSignal.timeout(5_000),
  });
  assert.match(String(output[0]), /AI workspace listening/);
  const origin = `http://127.0.0.1:${supervisor.port}`;
  const diagnostic = await fetch(`${origin}/api/diagnostic`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ message: "hello" }),
  });
  assert.deepEqual(await diagnostic.json(), { echo: "hello" });
  assert.match(await (await fetch(origin)).text(), /new/);
});

for (const failure of ["check", "build", "child-import", "listen", "publish"] as const) {
  test(`failed ${failure} preserves a usable current artifact and removes candidate`, async (context) => {
    const setup = await fixture(context);
    await writeFile(join(setup.state, "scenario"), failure);
    const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
    context.after(async () => supervisor.close());
    supervisor.reload("failure");
    await supervisor.waitForReload();
    assert.equal(supervisor.status().phase, "failed");
    assert.equal(supervisor.status().savedVersion, setup.initial.id);
    assert.equal(supervisor.status().servingVersion, setup.initial.id);
    assert.equal((await readArtifact(setup.state)).id, setup.initial.id);
    assert.match(await (await fetch(`http://127.0.0.1:${supervisor.port}`)).text(), /old/);
    assert.equal(
      (await readdir(setup.state)).filter((name) => name === "a" || name === "b").length,
      1,
    );
  });
}

test("startup ignores an interrupted candidate and recovers either side of pointer promotion", async (context) => {
  const setup = await fixture(context);
  const unfinished = await prepareArtifact(setup.state);
  await writeFile(join(setup.state, "current.next"), "b");
  let supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  await supervisor.close();
  assert.equal((await readArtifact(setup.state)).id, setup.initial.id);
  assert.equal((await readdir(setup.state)).includes("b"), false);

  const next = await prepareArtifact(setup.state);
  assert.equal(next.directory, unfinished.directory);
  await setup.emit(next, "promoted");
  await publishArtifact(setup.state, next);
  supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  assert.equal(supervisor.status().savedVersion, next.id);
  assert.match(await (await fetch(`http://127.0.0.1:${supervisor.port}`)).text(), /promoted/);
  assert.equal((await readdir(setup.state)).includes("a"), false);
});

test("overlapping requests do not interrupt current while checks run", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.state, "check.hold"), "");
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  supervisor.reload("first");
  await waitForCheck(setup.state);
  const origin = `http://127.0.0.1:${supervisor.port}`;
  async function request(requestId: string): Promise<Response> {
    return fetch(`${origin}/api/reload`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ requestId }),
    });
  }
  const [rejected, duplicate, status] = await Promise.all([
    request("second"),
    request("first"),
    fetch(`${origin}/api/reload`),
  ]);
  assert.equal(rejected.status, 409);
  assert.equal(duplicate.status, 202);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), supervisor.status());
  assert.deepEqual(await rejected.json(), supervisor.status());
  assert.deepEqual(await duplicate.json(), supervisor.status());
  assert.equal(supervisor.status().operationId, "first");
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  await rm(join(setup.state, "check.hold"));
  await supervisor.waitForReload();
  assert.equal(supervisor.status().phase, "succeeded");
});

test("shutdown terminates the pnpm check subprocess", async (context) => {
  const setup = await fixture(context);
  const bin = resolve(setup.source, "../../tools");
  await mkdir(bin);
  await writeFile(
    join(bin, "pnpm"),
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
import { join } from "node:path";
if (process.argv[2] !== "run" || process.argv[3] !== "check") process.exit(1);
writeFileSync(join(process.env.WORKSPACE_STATE_DIR, "check.pid"), String(process.pid));
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  const previousPath = process.env["PATH"];
  process.env["PATH"] = bin;
  context.after(() => {
    if (previousPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = previousPath;
  });
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  supervisor.reload("subprocess");
  const pid = await waitForCheck(setup.state);
  await supervisor.close();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal((await readArtifact(setup.state)).id, setup.initial.id);
});

test("shutdown cancels the active check without activating candidate", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.state, "check.hold"), "");
  const supervisor = await WorkspaceSupervisor.start({ ...setup, port: 0 });
  context.after(async () => supervisor.close());
  supervisor.reload("shutdown");
  const pid = await waitForCheck(setup.state);
  await supervisor.close();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(await readFile(join(setup.state, "commands"), "utf8"), "check\n");
  assert.equal((await readArtifact(setup.state)).id, setup.initial.id);
  assert.equal(
    (await readdir(setup.state)).filter((name) => name === "a" || name === "b").length,
    1,
  );
});
