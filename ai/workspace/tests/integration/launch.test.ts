import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const source = path.resolve(import.meta.dirname, "../..");
const context = [
  "--cwd",
  "/work directory",
  "--profile-dir",
  "/selected profile",
  "--code-navigation",
  "tilth",
];

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
    {
      timeout: 10_000,
      env: {
        ACCEL_OS: "/repository",
        AI_CWD: "/default directory",
        AI_UI_DEV_URL: "http://untrusted.invalid/",
        ELECTRON_RUN_AS_NODE: "1",
        ...env,
      },
    },
  );
}

test("launcher forwards explicit context without inheriting a development renderer", async () => {
  const { stdout } = await runFixture("launcher", context);
  assert.ok(
    stdout.includes(`args:${JSON.stringify([source, "--node", process.execPath, ...context])}`),
  );
  assert.ok(stdout.includes(`cwd:${source}`));
  assert.ok(stdout.includes("root:/repository"));
  assert.ok(stdout.includes("run-as-node:\n"));
  assert.ok(!stdout.includes("untrusted.invalid"));
  assert.ok(!stdout.includes("vite:"));
});

test("development launcher uses Vite's URL and closes it when Electron fails", async () => {
  await assert.rejects(
    runFixture("launcher", ["--dev"], { TEST_ELECTRON_EXIT: "1" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Electron exited \(1\)/u);
      assert.ok("stdout" in error && typeof error.stdout === "string");
      assert.ok(
        error.stdout.includes(
          `args:${JSON.stringify([
            source,
            "--node",
            process.execPath,
            "--cwd",
            "/default directory",
            "--dev-url",
            "http://127.0.0.1:5173/",
          ])}`,
        ),
      );
      assert.ok(error.stdout.includes("vite:listening"));
      assert.ok(error.stdout.includes("vite:closed"));
      return true;
    },
  );
});

test("Electron entry forwards profile and navigation to canonical Pi with built assets", async () => {
  const { stdout } = await runFixture("entry", ["--node", "/node", ...context]);
  assert.ok(stdout.includes("executable:/node"));
  assert.ok(
    stdout.includes(
      `args:${JSON.stringify([
        "/repository/ai/pi/runtime/rpc-entry.ts",
        "--profile-dir",
        "/selected profile",
        "--code-navigation",
        "tilth",
      ])}`,
    ),
  );
  assert.ok(stdout.includes("cwd:/work directory"));
  assert.ok(stdout.includes("renderer:built"));
  assert.ok(stdout.includes("user-data:default"));
});

test("normal startup rejects fake-execution overrides", async () => {
  await assert.rejects(
    runFixture("entry", ["--node", "/node", ...context, "--pi-entry", "/fake.ts"]),
    /Unknown option '--pi-entry'/u,
  );
});
