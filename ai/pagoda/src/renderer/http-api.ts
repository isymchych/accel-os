import { Schema } from "effect";

import {
  ControlsSchema,
  ErrorSchema,
  HistorySchema,
  MetadataSchema,
  SnapshotSchema,
  StoredSessionsSchema,
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
async function command<T extends Schema.ConstraintDecoder<unknown>>(
  name: string,
  request: unknown,
  schema: T,
): Promise<T["Type"]> {
  let response: Response;
  try {
    response = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error(
      "Backend connection lost. The command outcome is uncertain; it was not retried.",
    );
  }
  return decode(response, schema);
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
  return {
    directory: async (cwd) => command("directory", { cwd }, Schema.String),
    list: async (cwd) => command("list", { cwd }, StoredSessionsSchema),
    listAll: async () => command("list-all", {}, StoredSessionsSchema),
    setMetadataFlag: async (id, flag, value) => {
      await command("metadata-flag", { id, flag, value }, Schema.Null);
    },
    create: async (cwd) => command("create", { cwd }, SnapshotSchema),
    open: async (cwd, path) => command("open", { cwd, path }, SnapshotSchema),
    prompt: async (request) => command("prompt", request, Schema.String),
    stop: async (key) => {
      await command("stop", { key }, Schema.Null);
    },
    history: async (key) => command("history", { key }, HistorySchema),
    navigate: async (key, entryId) =>
      (await command("navigate", { key, entryId }, Schema.Union([Schema.String, Schema.Null]))) ??
      undefined,
    fork: async (key, entryId) => command("fork", { key, entryId }, SnapshotSchema),
    controls: async (key) => command("controls", { key }, ControlsSchema),
    model: async (key, provider, modelId) => {
      await command("model", { key, provider, modelId }, Schema.Null);
    },
    thinking: async (key, level) => {
      await command("thinking", { key, level }, Schema.Null);
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
