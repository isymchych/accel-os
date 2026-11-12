import { Effect, type FileSystem, Predicate, Schema, Semaphore } from "effect";

import { MetadataSchema, type SessionId, type SessionMetadata } from "../contracts/index.ts";

/** Pagoda presentation metadata, independent of Pi's native session files. */
export class SessionMetadataStore {
  private memory: SessionMetadata[] = [];
  private readonly file: string | undefined;
  private readonly fs: FileSystem.FileSystem;
  private readonly lock = Semaphore.makeUnsafe(1);

  public constructor(fs: FileSystem.FileSystem, file?: string) {
    this.fs = fs;
    this.file = file;
  }

  public list(): Effect.Effect<SessionMetadata[], unknown> {
    return this.lock.withPermits(1)(this.read());
  }

  private read(): Effect.Effect<SessionMetadata[], unknown> {
    return Effect.gen({ self: this }, function* () {
      if (!this.file) return structuredClone(this.memory);
      const contents = yield* this.fs
        .readFileString(this.file)
        .pipe(
          Effect.catch((error) =>
            Predicate.isTagged(error.reason, "NotFound")
              ? Effect.succeed(undefined)
              : Effect.fail(error),
          ),
        );
      if (contents === undefined) return [];
      const value: unknown = yield* Effect.try({
        try: (): unknown => JSON.parse(contents),
        catch: (error) => error,
      });
      if (!Schema.is(MetadataSchema)(value))
        return yield* Effect.fail(new Error("Invalid Pagoda session metadata"));
      return value.map(({ id, pinned, favourite }) => ({ id, pinned, favourite }));
    });
  }

  public setFlag(
    id: SessionId,
    flag: "pinned" | "favourite",
    value: boolean,
  ): Effect.Effect<SessionMetadata[], unknown> {
    return this.lock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const entries = yield* this.read();
        const index = entries.findIndex((entry) => entry.id === id);
        const previous = index < 0 ? { id, pinned: false, favourite: false } : entries[index];
        if (!previous) return yield* Effect.fail(new Error("Invalid session metadata"));
        const next = { ...previous, [flag]: value };
        if (index < 0) entries.push(next);
        else entries[index] = next;
        if (this.file)
          yield* this.fs.writeFileString(this.file, `${JSON.stringify(entries, null, 2)}\n`, {
            mode: 0o600,
          });
        else this.memory = entries;
        return entries;
      }),
    );
  }
}
