import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

test("CLI help and invalid arguments have the expected exit status", () => {
  const script = new URL("./index.ts", import.meta.url);
  const help = spawnSync(process.execPath, [script.pathname, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /video-url/u);
  for (const args of [[], ["one", "two"]]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
  }
});

test("CLI logs the requested URL even when it cannot start an interactive session", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mb-ydl-log-"));
  const output = path.join(directory, "journal");
  try {
    writeFileSync(
      path.join(directory, "logger"),
      `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_JOURNAL, fs.readFileSync(0, "utf8") + "\\n");
`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      process.execPath,
      [new URL("./index.ts", import.meta.url).pathname, "https://example.com/watch?v=123"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
          TEST_JOURNAL: output,
        },
      },
    );
    assert.notEqual(result.status, 0);
    const records = readFileSync(output, "utf8").split("\n\n");
    const request = records.find((record) => record.includes("MB_EVENT=request_received"));
    assert.match(request ?? "", /MB_URL=https:\/\/example\.com\/watch\?v=123/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
