import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Runtime, Stream } from "effect";
import type { PlatformError } from "effect";
import { Argument, Command } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { logEvent, withExecutionLog } from "../lib/execution-log.ts";

const templatesDirectory = fileURLToPath(
  new URL("../assets/mb-template/templates/", import.meta.url),
);

const templateNames = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectoryEntries(templatesDirectory);

  // Noctalia interpolates selections into a shell command without escaping.
  // Only expose plain filenames, and validate copying against the same allowlist.
  return entries
    .filter(
      (entry) => entry.type === "File" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
});

class ClipboardExitError extends Error {
  public override readonly [Runtime.errorExitCode]: number;

  public constructor(code: number) {
    super(`wl-copy exited with status ${code}`);
    this[Runtime.errorExitCode] = code;
  }
}

const copyTemplate = (
  name: string,
): Effect.Effect<
  void,
  Error | PlatformError.PlatformError,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const names = yield* templateNames;

    if (!names.includes(name)) return yield* Effect.fail(new Error(`Unknown template: ${name}`));

    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFile(join(templatesDirectory, name));
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("wl-copy", ["--type", "text/plain"], {
        stdin: Stream.make(content),
        stdout: "inherit",
        stderr: "pipe",
      }),
    );

    yield* child.stderr.pipe(
      Stream.tap((chunk) => Effect.sync(() => process.stderr.write(chunk))),
      Stream.decodeText(),
      Stream.runForEach((stderr) => logEvent("wl_copy_stderr", { stderr })),
    );

    const code = yield* child.exitCode;

    yield* logEvent("wl_copy_finished", {
      template: name,
      exit_code: code,
      outcome: code === 0 ? "success" : "failure",
    });

    if (code !== 0) return yield* Effect.fail(new ClipboardExitError(code));

    return yield* Effect.void;
  }).pipe(Effect.scoped);

const list = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const names = yield* templateNames;

    for (const name of names) {
      yield* Console.log(name);
    }
  }),
);

const copy = Command.make("copy", { name: Argument.String("name") }, ({ name }) =>
  copyTemplate(name),
);

const command = Command.make("mb-template").pipe(
  Command.withDescription("List templates or copy one to the clipboard."),
  Command.withSubcommands([list, copy]),
);

NodeRuntime.runMain(
  withExecutionLog(
    "mb-template",
    process.argv.length === 2
      ? Effect.fail(new Error("Usage: mb-template list | mb-template copy <name>"))
      : command.pipe(Command.run({ version: "1.0.0" })),
  ).pipe(
    Effect.tapError((error) =>
      Console.error(error instanceof Error ? error.message : String(error)),
    ),
    Effect.provide(NodeServices.layer),
  ),
  { disableErrorReporting: true },
);
