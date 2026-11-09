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

    const probes: { args: string[]; evidence: RegExp[] }[] = [
      {
        args: ["show", "src/main.ts:run", "--budget", "1000"],
        evidence: [/export function run\(\)/, /return helper\(\)/],
      },
      {
        args: [
          "discover",
          "run",
          "--as",
          "symbol",
          "--scope",
          "src",
          "--expand=1",
          "--budget",
          "1000",
        ],
        evidence: [/\[fn\]\s+run\s+src\/main\.ts/, /return helper\(\)/],
      },
      {
        args: ["context", "src/main.ts:run", "--scope", ".", "--budget", "1000"],
        evidence: [/src\/main\.ts:\d+-\d+ run/, /return helper\(\)/],
      },
      {
        args: ["trace", "callers", "helper", "--scope", "src", "--budget", "1000"],
        evidence: [/\[fn\]\s+run\s+src\/main\.ts:4/],
      },
      {
        args: ["trace", "callees", "run", "--detailed", "--scope", "src", "--budget", "1000"],
        evidence: [/helper\(\)/, /\[fn\]\s+helper\s+src\/(?:\.\/)?helper\.ts/],
      },
      {
        args: ["deps", "src/main.ts", "--scope", ".", "--budget", "1000"],
        evidence: [/helper\.ts\s+helper/],
      },
      {
        args: ["overview", "--scope", "src"],
        evidence: [/main\.ts/, /helper\.ts/],
      },
      {
        args: ["assess", "helper", "--scope", "src", "--budget", "1000"],
        evidence: [/\[def\]\s+src\/helper\.ts:\d+-\d+ export function helper/, /\[fn\]\s+run:4/],
      },
      {
        args: [
          "compare",
          "src/main.ts:run",
          "src/helper.ts:helper",
          "--scope",
          ".",
          "--budget",
          "1000",
        ],
        evidence: [/return helper\(\)/, /return "ok"/],
      },
    ];
    for (const { args, evidence } of probes) {
      const { stdout } = await run(binary, args, root);
      for (const expected of evidence) {
        assert.match(
          stdout,
          expected,
          `${args.join(" ")} did not return expected fixture evidence`,
        );
      }
    }

    await writeFile(
      path.join(root, "src", "helper.ts"),
      ["export function helper(): string {", '  return "changed";', "}", ""].join("\n"),
    );
    const { stdout: reviewOutput } = await run(binary, ["review", "--budget", "1000"], root);
    assert.match(reviewOutput, /src\/helper\.ts/);
    assert.match(reviewOutput, /return "changed"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
