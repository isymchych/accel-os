import { Effect, FileSystem, Predicate, Schema } from "effect";

import { operationError, OperationFailed, type OperationError } from "./errors.ts";

const SettingsSchema = Schema.Struct({
  sidebar: Schema.optionalKey(
    Schema.Struct({
      inactivityHours: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
    }),
  ),
});
const decodeSettings = Schema.decodeUnknownSync(SettingsSchema, { onExcessProperty: "error" });

export function readInactivityHours(
  file?: string,
): Effect.Effect<number, OperationError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (!file) return 48;
    const fs = yield* FileSystem.FileSystem;
    const contents = yield* fs
      .readFileString(file)
      .pipe(
        Effect.catch((error) =>
          Predicate.isTagged(error.reason, "NotFound")
            ? Effect.succeed(undefined)
            : Effect.fail(error),
        ),
      );
    if (contents === undefined) return 48;
    const value: unknown = yield* Effect.try({
      try: (): unknown => JSON.parse(contents),
      catch: (cause) =>
        Object.assign(new OperationFailed({ error: "Invalid Pagoda settings" }), { cause }),
    });
    const settings = yield* Effect.try({
      try: () => decodeSettings(value),
      catch: (cause) =>
        Object.assign(new OperationFailed({ error: "Invalid Pagoda settings" }), { cause }),
    });
    return settings.sidebar?.inactivityHours ?? 48;
  }).pipe(Effect.mapError(operationError));
}
