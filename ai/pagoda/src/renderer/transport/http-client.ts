import { Cause, Context, Effect, Exit, type Layer, type Schema } from "effect";
import { FetchHttpClient, type HttpClient, type HttpClientError } from "effect/http";
import { AtomHttpApi, AtomRegistry } from "effect/reactivity";

import { PagodaApi } from "../../contracts/api.ts";
import type { OperationError } from "../../contracts/errors.ts";
import { clientError, type ClientError } from "./errors.ts";

// oxlint-disable-next-line typescript/explicit-function-return-type -- Preserve the generated client's nominal service identity.
function defineClient(baseUrl: string, httpClient: Layer.Layer<HttpClient.HttpClient>) {
  class Client extends AtomHttpApi.Service<Client>()("PagodaRequests", {
    api: PagodaApi,
    httpClient,
    baseUrl,
  }) {}
  return Client;
}

type HttpService = ReturnType<typeof defineClient>;
export type HttpFailure = OperationError | HttpClientError.HttpClientError | Schema.SchemaError;
export type Command<A> = Effect.Effect<A, ClientError, AtomRegistry.AtomRegistry>;
export type CommandRunner = <A>(effect: Command<A>) => Promise<A>;

export interface PagodaClient {
  Client: HttpService;
  request: <A, E>(
    operation: (client: Context.Service.Shape<HttpService>) => Effect.Effect<A, E>,
  ) => Command<A>;
}

/** One generated HTTP client and atom runtime per authenticated application. */
export function createHttpClient(
  baseUrl: string,
  httpClient: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer,
): PagodaClient {
  const Client = defineClient(baseUrl, httpClient);
  function request<A, E>(
    operation: (client: Context.Service.Shape<typeof Client>) => Effect.Effect<A, E>,
  ): Effect.Effect<A, ClientError, AtomRegistry.AtomRegistry> {
    return Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;
      const context = yield* AtomRegistry.getResult(registry, Client.runtime);
      return yield* operation(Context.get(context, Client));
    }).pipe(Effect.mapError(clientError));
  }

  return { Client, request };
}

/** React's imperative boundary; each invocation retains its own correlated result. */
export async function runCommand<A>(
  registry: AtomRegistry.AtomRegistry,
  effect: Command<A>,
): Promise<A> {
  const result = await Effect.runPromiseExit(
    effect.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)),
  );
  if (Exit.isFailure(result)) throw clientError(Cause.squash(result.cause));
  return result.value;
}
