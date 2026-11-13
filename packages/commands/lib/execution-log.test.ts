import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Effect, Exit } from "effect";

import { logEvent, withExecutionLog } from "./execution-log.ts";

async function withJournal(
  check: (directory: string, records: () => Record<string, string>[]) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "execution-log-"));
  const journal = path.join(directory, "journal");
  const originalPath = process.env["PATH"];
  const originalJournal = process.env["TEST_JOURNAL"];
  try {
    writeFileSync(
      path.join(directory, "logger"),
      `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_JOURNAL, fs.readFileSync(0, "utf8") + "\\n");
`,
      { mode: 0o700 },
    );
    process.env["PATH"] = `${directory}${path.delimiter}${originalPath ?? ""}`;
    process.env["TEST_JOURNAL"] = journal;
    await check(directory, () =>
      readFileSync(journal, "utf8")
        .trimEnd()
        .split("\n\n")
        .map((record) => {
          const fields: Record<string, string> = {};
          for (const line of record.split("\n")) {
            const index = line.indexOf("=");
            const key = line.slice(0, index);
            const value = line.slice(index + 1);
            fields[key] = key in fields ? `${fields[key]}\n${value}` : value;
          }
          return fields;
        }),
    );
  } finally {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    if (originalJournal === undefined) delete process.env["TEST_JOURNAL"];
    else process.env["TEST_JOURNAL"] = originalJournal;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("invocation logging preserves arbitrary values, failures, and interruptions and flushes on exit", async () => {
  await withJournal(async (_directory, records) => {
    const value = { downloaded: ["one.mp4"] };
    assert.equal(
      await Effect.runPromise(
        withExecutionLog("test-command", Effect.succeed(value)).pipe(
          Effect.provide(NodeServices.layer),
        ),
      ),
      value,
    );
    await assert.rejects(
      Effect.runPromise(
        withExecutionLog("test-command", Effect.fail(new Error("download failed"))).pipe(
          Effect.provide(NodeServices.layer),
        ),
      ),
      /download failed/u,
    );
    const interrupted = await Effect.runPromiseExit(
      withExecutionLog("test-command", Effect.interrupt).pipe(Effect.provide(NodeServices.layer)),
    );
    assert.ok(Exit.hasInterrupts(interrupted));

    const entries = records();
    assert.equal(entries.length, 6);
    const runIds = new Set<string>();
    for (const [index, outcome] of ["success", "failure", "cancelled"].entries()) {
      const start = entries[index * 2];
      const finish = entries[index * 2 + 1];
      assert.ok(start);
      assert.ok(finish);
      assert.equal(start["MB_EVENT"], "run_started");
      assert.equal(finish["MB_EVENT"], "run_finished");
      assert.equal(finish["MB_OUTCOME"], outcome);
      assert.equal(start["SYSLOG_IDENTIFIER"], "test-command");
      assert.match(start["MB_RUN_ID"] ?? "", /^[0-9a-f-]{36}$/u);
      assert.equal(finish["MB_RUN_ID"], start["MB_RUN_ID"]);
      assert.ok(Number(finish["MB_DURATION_MS"]) >= 0);
      assert.equal(finish["MB_EXIT_CODE"], undefined);
      runIds.add(start["MB_RUN_ID"] ?? "");
    }
    assert.equal(runIds.size, 3);
    assert.match(entries[3]?.["MB_ERROR"] ?? "", /Error: download failed\n/u);
    assert.equal(entries[3]?.["PRIORITY"], "3");
  });
});

test("command cancellation is an explicit event, not a required return-value protocol", async () => {
  await withJournal(async (_directory, records) => {
    await Effect.runPromise(
      withExecutionLog(
        "test-command",
        logEvent("request_cancelled", { outcome: "cancelled", reason: "declined" }),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
    const entries = records();
    const cancelled = entries[1];
    const finish = entries[2];
    assert.ok(cancelled);
    assert.ok(finish);
    assert.equal(cancelled["MB_EVENT"], "request_cancelled");
    assert.equal(cancelled["MB_OUTCOME"], "cancelled");
    assert.equal(finish["MB_OUTCOME"], "success");
    assert.equal(cancelled["MB_RUN_ID"], finish["MB_RUN_ID"]);
  });
});

test("multiline diagnostics and structured fields survive without becoming injected journal fields", async () => {
  await withJournal(async (_directory, records) => {
    const stderr = "first line\nMB_OUTCOME=spoofed\nlast line\n";
    await Effect.runPromise(
      withExecutionLog(
        "test-command",
        logEvent("diagnostic", { stderr, details: { stage: "download" } }),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
    const entry = records()[1];
    assert.ok(entry);
    assert.equal(entry["MB_STDERR"], stderr);
    assert.equal(entry["MB_OUTCOME"], undefined);
    assert.deepEqual(JSON.parse(entry["MB_DETAILS"] ?? ""), { stage: "download" });
  });
});

test("unavailable or failing journald transport is visible but does not change program results", async () => {
  await withJournal(async (directory) => {
    for (const available of [true, false]) {
      if (available) {
        writeFileSync(path.join(directory, "logger"), "#!/bin/sh\nexit 7\n", { mode: 0o700 });
      } else {
        rmSync(path.join(directory, "logger"));
      }
      const code = `
import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))};
import { NodeServices } from ${JSON.stringify(import.meta.resolve("@effect/platform-node"))};
import { withExecutionLog } from ${JSON.stringify(new URL("./execution-log.ts", import.meta.url).href)};
const result = await Effect.runPromise(
  withExecutionLog("test-command", Effect.succeed({ answer: 42 })).pipe(Effect.provide(NodeServices.layer))
);
console.log(JSON.stringify(result));
await Effect.runPromise(
  withExecutionLog("test-command", Effect.fail(new Error("original failure"))).pipe(Effect.provide(NodeServices.layer))
).catch(error => { console.error(String(error)); process.exitCode = 1; });
`;
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
        encoding: "utf8",
        env: { ...process.env, PATH: directory },
      });
      assert.equal(result.status, 1);
      assert.deepEqual(JSON.parse(result.stdout), { answer: 42 });
      assert.match(result.stderr, /Execution log write failed:/u);
      assert.match(result.stderr, /original failure/u);
      if (available) assert.match(result.stderr, /logger exited with status 7/u);
    }
  });
});
