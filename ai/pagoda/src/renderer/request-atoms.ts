import { Cause, Context, Effect, type Layer, type Schema as S } from "effect";
import { FetchHttpClient, type HttpClient, type HttpClientError } from "effect/http";
import { AsyncResult, Atom, AtomHttpApi, AtomRegistry, Reactivity } from "effect/reactivity";

import { PagodaApi } from "../contracts/api.ts";
import type { OperationError } from "../contracts/errors.ts";
import type {
  Account,
  SessionControls,
  SessionHistory,
  SessionId,
  SessionKey,
  WorkspaceApi,
  StoredSession,
  Prompt,
} from "../contracts/index.ts";
import { requestError } from "./http-errors.ts";

export type ControlsChange =
  | { type: "model"; provider: string; modelId: string }
  | { type: "thinking"; level: string };

type RequestFailure = OperationError | HttpClientError.HttpClientError | S.SchemaError;

export interface RequestAtoms {
  catalog: Atom.Atom<AsyncResult.AsyncResult<readonly StoredSession[], OperationError>>;
  accounts: Atom.Atom<AsyncResult.AsyncResult<readonly Account[], OperationError>>;
  selectAccount: Atom.AtomResultFn<{ payload: { profile: string } }, null, RequestFailure>;
  history: (key: SessionKey) => Atom.Atom<AsyncResult.AsyncResult<SessionHistory, OperationError>>;
  controls: (
    key: SessionKey,
  ) => Atom.Atom<AsyncResult.AsyncResult<SessionControls, OperationError>>;
  changeControls: (key: SessionKey) => Atom.AtomResultFn<ControlsChange, null, RequestFailure>;
  stop: (key: SessionKey) => Atom.AtomResultFn<undefined, null, RequestFailure>;
  metadata: (
    id: SessionId,
    flag: "pinned" | "favourite",
  ) => Atom.AtomResultFn<boolean, null, RequestFailure>;
  commands: (registry: AtomRegistry.AtomRegistry) => Omit<WorkspaceApi, "subscribe">;
  promptEffect: (
    registry: AtomRegistry.AtomRegistry,
    request: Prompt,
  ) => Effect.Effect<string, unknown>;
}

/** Request state for one authenticated client; SSE and drafts retain their existing owners. */
export function createRequestAtoms(
  baseUrl: string,
  httpClient: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
): RequestAtoms {
  class Client extends AtomHttpApi.Service<Client>()("PagodaRequests", {
    api: PagodaApi,
    httpClient,
    baseUrl,
  }) {}

  const controlsKeys = (key: SessionKey): readonly string[] => [`controls:${key}`];
  const metadata = Atom.family((id: SessionId) =>
    Atom.family((flag: "pinned" | "favourite") =>
      Client.runtime
        .fn<boolean>()(
          Effect.fnUntraced(function* (value) {
            const client = yield* Client;
            return yield* client.workspace.metadataFlag({ payload: { id, flag, value } });
          }),
        )
        .pipe(Atom.keepAlive),
    ),
  );
  return {
    catalog: Client.query("workspace", "listAll", { payload: {} }),
    accounts: Client.query("workspace", "accounts", {}),
    selectAccount: Client.mutation("workspace", "selectAccount").pipe(Atom.keepAlive),
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
        // Switching views must not cancel an accepted command or lose its pending state.
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
    metadata: (id, flag) => metadata(id)(flag),
    promptEffect: (registry, request) =>
      AtomRegistry.getResult(registry, Client.runtime).pipe(
        Effect.flatMap((context) =>
          Context.get(context, Client).workspace.prompt({ payload: request }),
        ),
        Effect.mapError(requestError),
      ),
    commands: (registry) => {
      async function run<A, E>(
        operation: (client: Context.Service.Shape<typeof Client>) => Effect.Effect<A, E>,
      ): Promise<A> {
        const context = await Effect.runPromise(AtomRegistry.getResult(registry, Client.runtime));
        const result = await Effect.runPromise(
          Effect.match(operation(Context.get(context, Client)), {
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        );
        if (result.ok) return result.value;
        throw requestError(result.error);
      }
      return {
        directory: (cwd) => run((client) => client.workspace.directory({ payload: { cwd } })),
        create: (cwd) => run((client) => client.workspace.create({ payload: { cwd } })),
        open: (cwd, path) => run((client) => client.workspace.open({ payload: { cwd, path } })),
        prompt: (request) => run((client) => client.workspace.prompt({ payload: request })),
        navigate: async (key, entryId) =>
          (await run((client) => client.workspace.navigate({ payload: { key, entryId } }))) ??
          undefined,
        fork: (key, entryId) =>
          run((client) => client.workspace.fork({ payload: { key, entryId } })),
      };
    },
  };
}

export function requestFeedback<A, E>(result: AsyncResult.AsyncResult<A, E>): string | null {
  return AsyncResult.isFailure(result) && !result.waiting
    ? requestError(Cause.squash(result.cause)).message
    : null;
}
