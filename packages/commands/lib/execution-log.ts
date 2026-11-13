import { randomUUID } from "node:crypto";

import { Cause, Console, Effect, Exit, Formatter, Logger, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const journalEntry = Logger.make<unknown, string>((options) => {
  const entry = Logger.formatStructured.log(options);
  const fields: Record<string, unknown> = {
    SYSLOG_IDENTIFIER: entry.annotations["command"],
    MESSAGE: entry.message,
    PRIORITY: entry.level === "ERROR" || entry.annotations["outcome"] === "failure" ? 3 : 6,
    ...(entry.cause === undefined ? {} : { MB_ERROR: entry.cause }),
  };
  for (const [key, value] of Object.entries(entry.annotations)) {
    fields[`MB_${key.toUpperCase()}`] = value;
  }
  // logger --journald joins repeated MESSAGE fields with newlines; repeated custom
  // fields become journal arrays. Keep diagnostic lines intact rather than flattening them.
  return (
    Object.entries(fields)
      .flatMap(([key, value]) => {
        const text = typeof value === "string" ? value : Formatter.formatJson(value);
        return text.split("\n").map((line) => `${key}=${line}`);
      })
      .join("\n") + "\n"
  );
});

export const logEvent = (
  event: string,
  fields: Record<string, unknown> = {},
): Effect.Effect<void> => Effect.log(event).pipe(Effect.annotateLogs({ ...fields, event }));

const journalLogger = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Logger.batched(journalEntry, {
    window: "250 millis",
    flush: (entries) =>
      Effect.forEach(entries, (input) =>
        spawner
          .exitCode(
            ChildProcess.make("logger", ["--journald"], {
              stdin: Stream.encodeText(Stream.make(input)),
              stdout: "ignore",
              stderr: "inherit",
            }),
          )
          .pipe(
            Effect.flatMap((code) =>
              code === 0
                ? Effect.void
                : Effect.fail(new Error(`logger exited with status ${code}`)),
            ),
            Effect.catch((error) => Console.warn(`Execution log write failed: ${String(error)}`)),
          ),
      ).pipe(Effect.asVoid),
  });
});

/**
 * Log an invocation without interpreting or changing its result.
 * User-declined work is a command event; interruptions are a cancelled invocation.
 * Journald is best-effort, but transport failures are reported on stderr.
 */
export function withExecutionLog<A, E, R>(
  command: string,
  program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.suspend(() => {
    const start = performance.now();
    return Effect.gen(function* () {
      yield* logEvent("run_started");
      return yield* program.pipe(
        Effect.onExit((exit) =>
          logEvent("run_finished", {
            outcome: Exit.isSuccess(exit)
              ? "success"
              : Exit.hasInterrupts(exit)
                ? "cancelled"
                : "failure",
            duration_ms: Math.round(performance.now() - start),
            // Only subprocess records carry exit_code: this wrapper observes an Effect exit.
            ...(Exit.isFailure(exit) && !Exit.hasInterrupts(exit)
              ? { error: Cause.pretty(exit.cause) }
              : {}),
          }),
        ),
      );
    }).pipe(
      Effect.annotateLogs({ command, run_id: randomUUID() }),
      Effect.provide(Logger.layer([journalLogger])),
    );
  });
}
