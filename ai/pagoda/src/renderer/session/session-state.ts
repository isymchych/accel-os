import { Effect } from "effect";
import { Atom, Reactivity, type AsyncResult } from "effect/reactivity";

import type { OperationError } from "../../contracts/errors.ts";
import type {
  HistoryEntryId,
  Prompt,
  SessionKey,
  SessionSnapshot,
  SessionControls,
  SessionHistory,
} from "../../contracts/index.ts";
import type { Command, HttpFailure, PagodaClient } from "../transport/http-client.ts";

export type ControlsChange =
  | { type: "model"; provider: string; modelId: string }
  | { type: "thinking"; level: string };

export interface SessionState {
  history(key: SessionKey): Atom.Atom<AsyncResult.AsyncResult<SessionHistory, OperationError>>;
  controls(key: SessionKey): Atom.Atom<AsyncResult.AsyncResult<SessionControls, OperationError>>;
  changeControls(key: SessionKey): Atom.AtomResultFn<ControlsChange, null, HttpFailure>;
  stop(key: SessionKey): Atom.AtomResultFn<undefined, null, HttpFailure>;
  prompt: (payload: Prompt) => Command<string>;
  navigate(key: SessionKey, entryId: HistoryEntryId): Command<string | null>;
  fork(key: SessionKey, entryId: HistoryEntryId): Command<SessionSnapshot>;
}

/** Per-owner queries and commands; pending mutations survive view switches. */
export function createSessionState({ Client, request }: PagodaClient): SessionState {
  const controlsKeys = (key: SessionKey): readonly string[] => [`controls:${key}`];
  return {
    history: Atom.family((key: SessionKey) =>
      Client.query("workspace", "history", { payload: { key } }),
    ),
    controls: Atom.family((key: SessionKey) =>
      Client.query("workspace", "controls", {
        payload: { key },
        reactivityKeys: controlsKeys(key),
      }),
    ),
    changeControls: Atom.family((key: SessionKey) =>
      Client.runtime
        .fn<ControlsChange>()(
          Effect.fnUntraced(function* (change) {
            const client = yield* Client;
            return yield* Reactivity.mutation(
              change.type === "model"
                ? client.workspace.model({
                    payload: { key, provider: change.provider, modelId: change.modelId },
                  })
                : client.workspace.thinking({ payload: { key, level: change.level } }),
              controlsKeys(key),
            );
          }),
        )
        .pipe(Atom.keepAlive),
    ),
    stop: Atom.family((key: SessionKey) =>
      Client.runtime
        .fn<undefined>()(
          Effect.fnUntraced(function* () {
            const client = yield* Client;
            return yield* client.workspace.stop({ payload: { key } });
          }),
        )
        .pipe(Atom.keepAlive),
    ),
    prompt: (payload: Prompt) => request((client) => client.workspace.prompt({ payload })),
    navigate: (key: SessionKey, entryId: HistoryEntryId) =>
      request((client) => client.workspace.navigate({ payload: { key, entryId } })),
    fork: (key: SessionKey, entryId: HistoryEntryId) =>
      request((client) => client.workspace.fork({ payload: { key, entryId } })),
  };
}
