import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Effect, Logger, Schema } from "effect";

import { fetchMetadata } from "./yt-dlp.ts";

test("fetchMetadata accepts JSON larger than the default subprocess buffer", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mb-ydl-test-"));
  const originalPath = process.env["PATH"];
  try {
    writeFileSync(
      path.join(directory, "yt-dlp"),
      `#!${process.execPath}
process.stdout.write(JSON.stringify({
  title: "Large metadata",
  formats: [],
  description: "x".repeat(2 * 1024 * 1024)
}));
`,
      { mode: 0o700 },
    );
    process.env["PATH"] = `${directory}${path.delimiter}${originalPath ?? ""}`;

    assert.deepEqual(
      await Effect.runPromise(
        fetchMetadata("https://example.com/video").pipe(Effect.provide(NodeServices.layer)),
      ),
      {
        title: "Large metadata",
        isPlaylist: false,
        formats: [],
      },
    );
  } finally {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fetchMetadata reports process and spawn failures and rejects invalid metadata", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mb-ydl-test-"));
  const originalPath = process.env["PATH"];
  const executable = path.join(directory, "yt-dlp");
  try {
    process.env["PATH"] = `${directory}${path.delimiter}${originalPath ?? ""}`;
    writeFileSync(executable, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
    await assert.rejects(
      Effect.runPromise(fetchMetadata("example").pipe(Effect.provide(NodeServices.layer))),
      /yt-dlp exited with status 7/u,
    );
    writeFileSync(executable, `#!/bin/sh\nprintf '{"formats":"invalid"}'\n`, { mode: 0o700 });
    await assert.rejects(
      Effect.runPromise(fetchMetadata("example").pipe(Effect.provide(NodeServices.layer))),
    );
    rmSync(executable);
    process.env["PATH"] = directory;
    const records: Record<string, unknown>[] = [];
    const logger = Logger.make((options) => {
      records.push(Logger.formatStructured.log(options).annotations);
    });
    await assert.rejects(
      Effect.runPromise(
        fetchMetadata("example").pipe(
          Effect.provide(NodeServices.layer),
          Effect.provide(Logger.layer([logger])),
        ),
      ),
      /yt-dlp/u,
    );
    const finish = records.find((entry) => entry["event"] === "metadata_finished");
    assert.ok(finish);
    assert.equal(finish["outcome"], "failure");
    assert.match(String(finish["error"]), /yt-dlp/u);
    assert.equal(finish["exit_code"], undefined);
  } finally {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [stage, exitCode] of [
  ["metadata", 7],
  ["download", 7],
  ["download", 0],
] as const) {
  test(`${stage} subprocess streams output and logs diagnostics and status (${exitCode})`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mb-ydl-stderr-"));
    const journal = path.join(directory, "journal");
    const argsFile = path.join(directory, "args.json");
    try {
      writeFileSync(
        path.join(directory, "yt-dlp"),
        `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(process.env.TEST_ARGS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.TEST_STAGE === "metadata"
  ? JSON.stringify({ title: "Example", formats: [], description: "x".repeat(2 * 1024 * 1024) })
  : "download progress\\n");
process.stderr.write("yt-dlp diagnostic details\\n" + "x".repeat(70 * 1024) + " end\\n");
process.exitCode = Number(process.env.TEST_EXIT_CODE);
`,
        { mode: 0o700 },
      );
      writeFileSync(
        path.join(directory, "logger"),
        `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_JOURNAL, fs.readFileSync(0, "utf8") + "\\n");
`,
        { mode: 0o700 },
      );
      const code = `
import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))};
import { NodeServices } from ${JSON.stringify(import.meta.resolve("@effect/platform-node"))};
import { fetchMetadata, downloadMedia } from ${JSON.stringify(new URL("./yt-dlp.ts", import.meta.url).href)};
import { withExecutionLog } from ${JSON.stringify(new URL("../../lib/execution-log.ts", import.meta.url).href)};
const operation = ${
        stage === "metadata"
          ? 'fetchMetadata("example")'
          : 'downloadMedia("example", { kind: "audio", id: "audio-mp3", label: "MP3", format: "chosen-audio", audioFormat: "mp3", size: undefined })'
      };
await Effect.runPromise(
  withExecutionLog("mb-ydl", operation).pipe(Effect.provide(NodeServices.layer))
).catch(() => { process.exitCode = 1; });
`;
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
          TEST_JOURNAL: journal,
          TEST_ARGS: argsFile,
          TEST_STAGE: stage,
          TEST_EXIT_CODE: String(exitCode),
        },
      });
      assert.equal(result.status, exitCode === 0 ? 0 : 1);
      const stderr = `yt-dlp diagnostic details\n${"x".repeat(70 * 1024)} end\n`;
      assert.equal(result.stderr, stderr);
      assert.equal(result.stdout, stage === "download" ? "download progress\n" : "");
      const records = readFileSync(journal, "utf8")
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
        });
      const diagnostics = records.filter((entry) => entry["MB_EVENT"] === "yt_dlp_stderr");
      assert.equal(diagnostics.map((entry) => entry["MB_STDERR"]).join(""), stderr);
      assert.ok(diagnostics.every((entry) => entry["MB_STAGE"] === stage));
      const finish = records.find((entry) => entry["MB_EVENT"] === `${stage}_finished`);
      assert.ok(finish);
      assert.equal(finish["MB_EXIT_CODE"], String(exitCode));
      assert.equal(finish["MB_OUTCOME"], exitCode === 0 ? "success" : "failure");
      assert.ok(Number(finish["MB_DURATION_MS"]) >= 0);
      assert.ok(records.every((entry) => entry["MB_RUN_ID"] === finish["MB_RUN_ID"]));
      if (stage === "download") {
        assert.deepEqual(JSON.parse(readFileSync(argsFile, "utf8")), [
          "--no-playlist",
          "-o",
          "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s",
          "--format",
          "chosen-audio",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "example",
        ]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("interrupting a subprocess retains earlier diagnostics and terminates the child", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mb-ydl-interrupt-"));
  const stopped = path.join(directory, "stopped");
  try {
    writeFileSync(
      path.join(directory, "yt-dlp"),
      `#!${process.execPath}
const fs = require("node:fs");
process.on("SIGTERM", () => { fs.writeFileSync(process.env.TEST_STOPPED, "stopped"); process.exit(0); });
process.stderr.write("before interruption\\n");
setTimeout(() => process.exit(99), 5000);
`,
      { mode: 0o700 },
    );
    const code = `
import { Deferred, Effect, Fiber, Logger } from ${JSON.stringify(import.meta.resolve("effect"))};
import { NodeServices } from ${JSON.stringify(import.meta.resolve("@effect/platform-node"))};
import { fetchMetadata } from ${JSON.stringify(new URL("./yt-dlp.ts", import.meta.url).href)};
const records = await Effect.runPromise(Effect.gen(function* () {
  const ready = yield* Deferred.make();
  const entries = [];
  const logger = Logger.make(options => {
    const entry = Logger.formatStructured.log(options);
    entries.push(entry.annotations);
    if (entry.annotations.event === "yt_dlp_stderr") Effect.runSync(Deferred.succeed(ready, undefined));
  });
  yield* Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(fetchMetadata("example"));
    yield* Deferred.await(ready);
    yield* Fiber.interrupt(fiber);
  }).pipe(Effect.provide(Logger.layer([logger])));
  return entries;
}).pipe(Effect.provide(NodeServices.layer)));
console.log(JSON.stringify(records));
`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
        TEST_STOPPED: stopped,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "before interruption\n");
    const records = Schema.decodeUnknownSync(
      Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    )(JSON.parse(result.stdout));
    assert.equal(
      records.find((entry) => entry["event"] === "yt_dlp_stderr")?.["stderr"],
      result.stderr,
    );
    assert.equal(records.at(-1)?.["event"], "metadata_finished");
    assert.equal(records.at(-1)?.["outcome"], "cancelled");
    assert.equal(records.at(-1)?.["exit_code"], undefined);
    assert.equal(readFileSync(stopped, "utf8"), "stopped");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
