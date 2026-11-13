import { Effect } from "effect";
import { Atom } from "effect/reactivity";

import type { Prompt, SessionKey } from "../../contracts/index.ts";
import { requestFeedback } from "../transport/errors.ts";
import type { Command } from "../transport/http-client.ts";

interface Draft {
  message: string;
  revision: number;
  uncertain: boolean;
}

export interface Composer {
  message: string;
  pending: boolean;
  feedback: { kind: "error"; message: string } | null;
}

interface ComposerEdit {
  message: string;
  fromHistory?: boolean;
}

interface OwnerComposerAtoms {
  state: Atom.Atom<Composer>;
  edit: Atom.Writable<Composer, ComposerEdit>;
  submit: Atom.Writable<Composer, Prompt["mode"]>;
  hasDraft: Atom.Atom<boolean>;
}

export type ComposerAtoms = (key: SessionKey) => OwnerComposerAtoms;

const uncertain =
  "The submission may have been rejected or its outcome is uncertain; it was not retried.";

/** Drafts, storage, and submission lifetime are isolated by execution owner. */
export function createComposerAtoms(
  storage: Storage,
  prompt: (request: Prompt) => Command<string>,
): ComposerAtoms {
  function create(key: SessionKey): OwnerComposerAtoms {
    const draftKey = `pi-composer:${key}`;
    const pendingKey = `pi-submitting:${key}`;
    const draft = Atom.make<Draft>({
      message: storage.getItem(draftKey) ?? "",
      revision: 0,
      uncertain: Boolean(storage.getItem(pendingKey)),
    }).pipe(Atom.keepAlive);
    const submission = Atom.fn<Prompt["mode"]>()((mode, ctx) =>
      Effect.gen(function* () {
        const submitted = ctx.registry.get(draft);
        yield* prompt({ key, message: submitted.message, mode });
        const latest = ctx.registry.get(draft);
        const unchanged = latest.revision === submitted.revision;
        if (unchanged) storage.setItem(draftKey, "");
        storage.removeItem(pendingKey);
        ctx.set(draft, {
          ...latest,
          message: unchanged ? "" : latest.message,
          uncertain: false,
        });
      }),
    ).pipe(Atom.keepAlive);
    const state = Atom.make((get): Composer => {
      const current = get(draft);
      const result = get(submission);
      const error = requestFeedback(result, true) ?? (current.uncertain ? uncertain : null);
      return {
        message: current.message,
        pending: result.waiting,
        feedback: error === null ? null : { kind: "error", message: error },
      };
    });
    const edit = Atom.writable(
      (get) => get(state),
      (ctx, { message, fromHistory = false }: ComposerEdit) => {
        const current = ctx.get(draft);
        storage.setItem(draftKey, message);
        if (!fromHistory && !ctx.get(submission).waiting) {
          storage.removeItem(pendingKey);
          ctx.set(submission, Atom.Reset);
        }
        ctx.set(draft, {
          message,
          revision: current.revision + 1,
          uncertain: fromHistory ? current.uncertain : false,
        });
      },
    );
    const submit = Atom.writable(
      (get) => get(state),
      (ctx, mode: Prompt["mode"]) => {
        if (ctx.get(submission).waiting) return;
        storage.setItem(pendingKey, "pending");
        ctx.set(draft, { ...ctx.get(draft), uncertain: false });
        ctx.set(submission, mode);
      },
    );
    return { state, edit, submit, hasDraft: Atom.map(draft, (value) => Boolean(value.message)) };
  }

  // Atom.family weakly retains containers, while the registry retains only their atoms.
  // Keep each owner's definitions stable for the application lifetime, including pending sends.
  const owners = new Map<SessionKey, OwnerComposerAtoms>();
  return (key) => {
    const existing = owners.get(key);
    if (existing) return existing;
    const owner = create(key);
    owners.set(key, owner);
    return owner;
  };
}
