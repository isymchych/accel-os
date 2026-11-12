import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { PagodaApi } from "../contracts/api.ts";
import {
  ErrorSchema,
  MetadataSchema,
  SnapshotSchema,
  WorkspaceSchema,
  type WorkspaceApi,
  type WorkspaceObservation,
} from "../contracts/index.ts";

async function decode<T extends Schema.ConstraintDecoder<unknown>>(
  response: Response,
  schema: T,
): Promise<T["Type"]> {
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(Schema.is(ErrorSchema)(value) ? value.error : "Backend request failed");
  }
  if (!Schema.is(schema)(value)) throw new Error("Invalid backend response");
  return value;
}
/** Bootstrap credentials stay in a URL fragment only until exchanged for an HttpOnly cookie. */
export async function connectApi(): Promise<WorkspaceApi> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token");
  if (token === null) {
    await decode(await fetch("/api/auth", { credentials: "same-origin" }), Schema.Null);
  } else {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    await decode(
      await fetch("/api/auth", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      }),
      Schema.Null,
    );
  }
  const client = await Effect.runPromise(
    HttpApiClient.make(PagodaApi, { baseUrl: window.location.origin }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );
  async function command<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
    const result = await Effect.runPromise(
      operation.pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      ),
    );
    if (result.ok) return result.value;
    const error: unknown = result.error;
    if (Schema.is(ErrorSchema)(error)) throw new Error(error.error);
    if (
      HttpClientError.isHttpClientError(error) &&
      error.reason instanceof HttpClientError.TransportError
    )
      throw new Error(
        "Backend connection lost. The command outcome is uncertain; it was not retried.",
      );
    throw new Error("Backend request failed");
  }
  return {
    directory: async (cwd) => command(client.workspace.directory({ payload: { cwd } })),
    list: async (cwd) => command(client.workspace.list({ payload: { cwd } })),
    listAll: async () => command(client.workspace.listAll({ payload: {} })),
    setMetadataFlag: async (id, flag, value) => {
      await command(client.workspace.metadataFlag({ payload: { id, flag, value } }));
    },
    create: async (cwd) => command(client.workspace.create({ payload: { cwd } })),
    open: async (cwd, path) => command(client.workspace.open({ payload: { cwd, path } })),
    prompt: async (request) => command(client.workspace.prompt({ payload: request })),
    stop: async (key) => {
      await command(client.workspace.stop({ payload: { key } }));
    },
    history: async (key) => command(client.workspace.history({ payload: { key } })),
    navigate: async (key, entryId) =>
      (await command(client.workspace.navigate({ payload: { key, entryId } }))) ?? undefined,
    fork: async (key, entryId) => command(client.workspace.fork({ payload: { key, entryId } })),
    controls: async (key) => command(client.workspace.controls({ payload: { key } })),
    model: async (key, provider, modelId) => {
      await command(client.workspace.model({ payload: { key, provider, modelId } }));
    },
    thinking: async (key, level) => {
      await command(client.workspace.thinking({ payload: { key, level } }));
    },
    subscribe: (listener, connection) => {
      const events = new EventSource("/api/events");
      function observe<T extends Schema.ConstraintDecoder<unknown>>(
        name: string,
        schema: T,
        observation: (value: T["Type"]) => WorkspaceObservation,
      ): void {
        events.addEventListener(name, (event: MessageEvent<string>) => {
          try {
            const value: unknown = JSON.parse(event.data);
            if (!Schema.is(schema)(value)) throw new Error(`Invalid ${name} event`);
            listener(observation(value));
            if (name === "ready") connection?.(true);
          } catch {
            events.close();
            connection?.(false);
          }
        });
      }
      observe("ready", WorkspaceSchema, (workspace) => ({ type: "workspace", workspace }));
      observe("snapshot", SnapshotSchema, (snapshot) => ({ type: "snapshot", snapshot }));
      observe("metadata", MetadataSchema, (metadata) => ({ type: "metadata", metadata }));
      events.onerror = (): void => {
        connection?.(false);
      };
      return () => {
        events.close();
      };
    },
  };
}
