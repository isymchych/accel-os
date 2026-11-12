import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const source = path.resolve(import.meta.dirname, "../..");
const url = `http://127.0.0.1:4317/#token=${"a".repeat(64)}`;
async function runFixture(
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  // oxlint-disable-next-line typescript/strict-void-return -- execFile has a native custom promisify implementation.
  return promisify(execFile)(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      path.join(import.meta.dirname, "fixtures", `${name}.ts`),
      ...args,
    ],
    { timeout: 10_000, env: { PAGODA_URL: url, ...env } },
  );
}
test("the Electron launcher starts a backend and owns its lifetime", async () => {
  const { stdout } = await runFixture("launcher", []);
  assert.ok(stdout.includes(`args:${JSON.stringify([source])}`));
  assert.ok(stdout.includes(`cwd:${source}`));
  assert.ok(!stdout.includes("vite:"));
  assert.ok(stdout.includes("backend/entry.js"));
  assert.ok(stdout.includes("killed:backend"));
});
test("browser mode opens the URL and keeps the backend until interrupted", async () => {
  const { stdout } = await runFixture("launcher", ["--browser"], { TEST_BROWSER: "1" });
  assert.ok(stdout.includes(`Pagoda connection URL: ${url}`));
  assert.ok(stdout.includes(`args:${JSON.stringify([url])}`));
  assert.ok(stdout.includes("killed:backend"));
});
test("the Electron launcher reports shell failure", async () => {
  await assert.rejects(
    runFixture("launcher", [], { TEST_ELECTRON_EXIT: "1" }),
    /Electron exited \(1\)/u,
  );
});
test("backend startup failure does not launch a client", async () => {
  await assert.rejects(
    runFixture("launcher", [], { TEST_BACKEND_FAIL: "1" }),
    (error: { stdout: string; stderr: string }) => {
      assert.match(error.stderr, /Backend exited \(1\)/u);
      assert.doesNotMatch(error.stdout, /executable:\/fake\/electron/u);
      return true;
    },
  );
});
test("shutdown at backend readiness does not launch either client", async () => {
  for (const args of [[], ["--browser"]]) {
    const { stdout } = await runFixture("launcher", args, { TEST_STOP_ON_READY: "1" });
    assert.match(stdout, /killed:backend/u);
    assert.equal(stdout.match(/executable:/gu)?.length, 1);
  }
});
test("Electron entry attaches to an explicitly configured backend", async () => {
  const { stdout } = await runFixture("entry", []);
  assert.ok(stdout.includes(`renderer:${url}`));
});
test("client entry and launcher reject fake overrides", async () => {
  for (const option of ["--pi-entry", "--dev"]) {
    await assert.rejects(runFixture("entry", [option, "/unused"]), /Unknown option/u);
    await assert.rejects(runFixture("launcher", [option, "/unused"]), /Unknown option/u);
  }
});

test("server launcher owns configuration and development Vite lifetime", async () => {
  const context = ["--cwd", source];
  const { stdout } = await runFixture("launcher", ["--dev", ...context, "--port", "4321"], {
    TEST_LAUNCHER_TARGET: "server",
    ACCEL_OS: "/repository",
  });
  assert.ok(
    stdout.includes(
      `args:${JSON.stringify([
        path.join(source, "dist/main/backend/entry.js"),
        ...context.slice(0, 2),
        "--port",
        "4321",
        "--dev",
      ])}`,
    ),
  );
  assert.ok(stdout.includes("root:/repository"));
  assert.ok(stdout.includes("vite:listening"));
  assert.ok(stdout.includes("vite:closed"));
});

test("server entry configures native SDK execution and shared account discovery", async () => {
  const { stdout } = await runFixture("server-entry", ["--cwd", source], {
    ACCEL_OS: "/repository",
  });
  assert.ok(
    stdout.includes(
      `sdk:${JSON.stringify({
        cwd: source,
        agentDir: "/repository/ai/pi",
        profileDir: "/repository/ai/pi",
        sessionDir: "/repository/ai/pi/sessions",
        sharedDir: "/repository/ai",
      })}`,
    ),
  );
  assert.ok(stdout.includes(`cwd:${source}`));
  assert.ok(stdout.includes("renderer:built"));
  assert.ok(stdout.includes("accounts:/repository/ai/pi"));
  assert.doesNotMatch(stdout, /rpc-entry/u);
  for (const option of ["--pi-entry", "--profile-dir", "--code-navigation"]) {
    await assert.rejects(
      runFixture("server-entry", [option, "/unused"], { ACCEL_OS: "/repository" }),
      /Unknown option/u,
    );
    await assert.rejects(runFixture("launcher", [option, "/unused"]), /Unknown option/u);
  }
});

test("backend shutdown stays idempotent when the terminal and launchers forward multiple signals", async () => {
  await runFixture("server-entry", ["--cwd", source], {
    ACCEL_OS: "/repository",
    TEST_REPEAT_SIGNALS: "1",
  });
});
