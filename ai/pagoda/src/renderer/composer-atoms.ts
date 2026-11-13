import { Cause, Effect, Schema } from "effect";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { Prompt, SessionKey } from "../contracts/index.ts";
import { TargetSchema } from "../contracts/index.ts";

interface Composer {
  message: string;
  pending: boolean;
  feedback: { kind: "error"; message: string } | null;
  revision: number;
}

type Composers = Partial<Record<SessionKey, Composer>>;
type Edit = { key: SessionKey; message: string; fromHistory?: boolean };
type Submission = { key: SessionKey; mode: Prompt["mode"] };

const uncertain =
  "The submission may have been rejected or its outcome is uncertain; it was not retried.";

export interface ComposerAtoms {
  state: Atom.Atom<Composers>;
  edit: Atom.Writable<Composers, Edit>;
  submit: Atom.Writable<Composers, Submission>;
  read: (composers: Composers, key: SessionKey | null) => Composer;
}

/** Client-local drafts and submissions remain attached to their execution owners. */
export function createComposerAtoms(
  storage: Storage,
  prompt: (registry: AtomRegistry.AtomRegistry, request: Prompt) => Effect.Effect<string, unknown>,
): ComposerAtoms {
  const drafts = Atom.make<Composers>({}).pipe(Atom.keepAlive);
  const submission = Atom.family((key: SessionKey) =>
    Atom.fn<Prompt["mode"]>()((mode, ctx) =>
      Effect.gen(function* () {
        const current = ctx.registry.get(drafts);
        const composer = read(current, key);
        yield* prompt(ctx.registry, { key, message: composer.message, mode });
        const latest = ctx.registry.get(drafts);
        const next = read(latest, key);
        const unchanged = next.revision === composer.revision;
        if (unchanged) storage.setItem(`pi-composer:${key}`, "");
        storage.removeItem(`pi-submitting:${key}`);
        ctx.set(drafts, {
          ...latest,
          [key]: { ...next, message: unchanged ? "" : next.message, feedback: null },
        });
      }),
    ).pipe(Atom.keepAlive),
  );
  const state = Atom.make((get) => {
    const current = get(drafts);
    const result: Composers = {};
    for (const [rawKey, composer] of Object.entries(current)) {
      if (!composer) continue;
      const key = Schema.decodeUnknownSync(TargetSchema.fields.key)(rawKey);
      const operation = get(submission(key));
      const failure: unknown =
        AsyncResult.isFailure(operation) && !operation.waiting
          ? Cause.squash(operation.cause)
          : undefined;
      result[key] = {
        ...composer,
        pending: operation.waiting,
        feedback:
          failure === undefined
            ? composer.feedback
            : {
                kind: "error",
                message:
                  failure instanceof Error ? failure.message : "The workspace operation failed.",
              },
      };
    }
    return result;
  });
  const read = (composers: Composers, key: SessionKey | null): Composer =>
    (key === null ? undefined : composers[key]) ?? {
      message: key === null ? "" : (storage.getItem(`pi-composer:${key}`) ?? ""),
      pending: false,
      feedback:
        key !== null && storage.getItem(`pi-submitting:${key}`)
          ? { kind: "error", message: uncertain }
          : null,
      revision: 0,
    };
  const edit = Atom.writable(
    (get) => get(state),
    (ctx, { key, message, fromHistory }: Edit) => {
      const current = ctx.get(drafts);
      const composer = read(current, key);
      storage.setItem(`pi-composer:${key}`, message);
      if (!fromHistory && !ctx.get(submission(key)).waiting) {
        storage.removeItem(`pi-submitting:${key}`);
        ctx.set(submission(key), Atom.Reset);
      }
      ctx.set(drafts, {
        ...current,
        [key]: {
          ...composer,
          message,
          revision: composer.revision + 1,
          feedback: fromHistory ? composer.feedback : null,
        },
      });
    },
  );
  const submit = Atom.writable(
    (get) => get(state),
    (ctx, { key, mode }: Submission) => {
      if (ctx.get(submission(key)).waiting) return;
      const current = ctx.get(drafts);
      const composer = read(current, key);
      storage.setItem(`pi-submitting:${key}`, "pending");
      ctx.set(drafts, { ...current, [key]: { ...composer, feedback: null } });
      ctx.set(submission(key), mode);
    },
  );
  return { state, edit, submit, read };
}
