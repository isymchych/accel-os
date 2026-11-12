import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

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
} from "../desktop-api.ts";

async function decode<T extends TSchema>(response: Response, schema: T): Promise<Static<T>> {
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(Value.Check(ErrorSchema, value) ? value.error : "Backend request failed");
  }
  if (!Value.Check(schema, value)) throw new Error("Invalid backend response");
  return value;
}
async function command<T extends TSchema>(
  name: string,
  request: unknown,
  schema: T,
): Promise<Static<T>> {
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
    await decode(await fetch("/api/auth", { credentials: "same-origin" }), Type.Null());
  } else {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    await decode(
      await fetch("/api/auth", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      }),
      Type.Null(),
    );
  }
  return {
    directory: async (cwd) => command("directory", { cwd }, Type.String()),
    list: async (cwd) => command("list", { cwd }, StoredSessionsSchema),
    listAll: async () => command("list-all", {}, StoredSessionsSchema),
    setMetadataFlag: async (id, flag, value) => {
      await command("metadata-flag", { id, flag, value }, Type.Null());
    },
    create: async (cwd) => command("create", { cwd }, SnapshotSchema),
    open: async (cwd, path) => command("open", { cwd, path }, SnapshotSchema),
    prompt: async (request) => command("prompt", request, Type.String()),
    stop: async (key) => {
      await command("stop", { key }, Type.Null());
    },
    history: async (key) => command("history", { key }, HistorySchema),
    navigate: async (key, entryId) =>
      (await command("navigate", { key, entryId }, Type.Union([Type.String(), Type.Null()]))) ??
      undefined,
    fork: async (key, entryId) => command("fork", { key, entryId }, SnapshotSchema),
    controls: async (key) => command("controls", { key }, ControlsSchema),
    model: async (key, provider, modelId) => {
      await command("model", { key, provider, modelId }, Type.Null());
    },
    thinking: async (key, level) => {
      await command("thinking", { key, level }, Type.Null());
    },
    subscribe: (listener, connection) => {
      const events = new EventSource("/api/events");
      function observe<T extends TSchema>(
        name: string,
        schema: T,
        observation: (value: Static<T>) => WorkspaceObservation,
      ): void {
        events.addEventListener(name, (event: MessageEvent<string>) => {
          try {
            const value: unknown = JSON.parse(event.data);
            if (!Value.Check(schema, value)) throw new Error(`Invalid ${name} event`);
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
