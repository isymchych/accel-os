import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { resolveSrcwalkBinaryPath } from "./tool.ts";

const execFileAsync = promisify(execFile);

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

test("srcwalk navigation and review commands work against a temporary repository", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "srcwalk-contract-"));
  const binary = resolveSrcwalkBinaryPath();
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "main.ts"),
      [
        'import { helper } from "./helper.ts";',
        "",
        "export function run(): string {",
        "  return helper();",
        "}",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "src", "helper.ts"),
      ["export function helper(): string {", '  return "ok";', "}", ""].join("\n"),
    );

    await run("git", ["init", "--quiet"], root);
    await run("git", ["config", "user.email", "srcwalk-contract@example.invalid"], root);
    await run("git", ["config", "user.name", "srcwalk contract"], root);
    await run("git", ["add", "."], root);
    await run("git", ["commit", "--quiet", "-m", "fixture"], root);

    const probes: string[][] = [
      ["show", "src/main.ts:run", "--budget", "1000"],
      ["discover", "run", "--as", "symbol", "--scope", "src", "--expand=1", "--budget", "1000"],
      ["context", "src/main.ts:run", "--scope", ".", "--budget", "1000"],
      ["trace", "callers", "helper", "--scope", "src", "--budget", "1000"],
      ["trace", "callees", "run", "--detailed", "--scope", "src", "--budget", "1000"],
      ["deps", "src/main.ts", "--scope", ".", "--budget", "1000"],
      ["overview", "--scope", "src"],
      ["assess", "helper", "--scope", "src", "--budget", "1000"],
      ["compare", "src/main.ts:run", "src/helper.ts:helper", "--scope", ".", "--budget", "1000"],
    ];
    for (const args of probes) {
      const { stdout } = await run(binary, args, root);
      assert.notEqual(stdout.trim(), "", `${args.join(" ")} returned no output`);
    }

    await writeFile(
      path.join(root, "src", "helper.ts"),
      ["export function helper(): string {", '  return "changed";', "}", ""].join("\n"),
    );
    const { stdout: reviewOutput } = await run(binary, ["review", "--budget", "1000"], root);
    assert.match(reviewOutput, /helper/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
