import { Effect, Layer, type FileSystem, type Path } from "effect";
import type { Etag, HttpPlatform, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { PagodaApi } from "../contracts/api.ts";
import type { DesktopWorkspace } from "./workspace.ts";

/** Adapts the existing workspace owner to the shared HTTP contract. */
export function workspaceApi(
  workspace: DesktopWorkspace,
): Layer.Layer<
  never,
  never,
  | FileSystem.FileSystem
  | Etag.Generator
  | HttpPlatform.HttpPlatform
  | HttpRouter.HttpRouter
  | Path.Path
> {
  function operation<A>(action: () => A | Promise<A>): Effect.Effect<A, { error: string }> {
    return Effect.tryPromise({
      try: async () => action(),
      catch: (error) => ({
        error: error instanceof Error ? error.message : "Operation failed",
      }),
    }).pipe(Effect.uninterruptible);
  }

  const handlers = HttpApiBuilder.group(PagodaApi, "workspace", (group) =>
    group
      .handle("workspace", () => Effect.sync(() => workspace.snapshot()))
      .handle("directory", ({ payload }) => operation(() => workspace.directory(payload.cwd)))
      .handle("list", ({ payload }) => operation(() => workspace.list(payload.cwd)))
      .handle("listAll", () => operation(() => workspace.listAll()))
      .handle("metadataFlag", ({ payload }) =>
        operation(async () => {
          await workspace.setMetadataFlag(payload.id, payload.flag, payload.value);
          return null;
        }),
      )
      .handle("create", ({ payload }) => operation(() => workspace.create(payload.cwd)))
      .handle("open", ({ payload }) => operation(() => workspace.open(payload.cwd, payload.path)))
      .handle("snapshot", ({ payload }) =>
        operation(() => workspace.session(payload.key).snapshot()),
      )
      .handle("prompt", ({ payload }) => operation(() => workspace.prompt(payload)))
      .handle("stop", ({ payload }) =>
        operation(async () => {
          await workspace.session(payload.key).stop();
          return null;
        }),
      )
      .handle("history", ({ payload }) => operation(() => workspace.session(payload.key).history()))
      .handle("navigate", ({ payload }) =>
        operation(
          async () => (await workspace.session(payload.key).navigate(payload.entryId)) ?? null,
        ),
      )
      .handle("fork", ({ payload }) =>
        operation(() => workspace.fork(payload.key, payload.entryId)),
      )
      .handle("controls", ({ payload }) =>
        operation(() => workspace.session(payload.key).controls()),
      )
      .handle("model", ({ payload }) =>
        operation(async () => {
          await workspace.session(payload.key).model(payload.provider, payload.modelId);
          return null;
        }),
      )
      .handle("thinking", ({ payload }) =>
        operation(async () => {
          await workspace.session(payload.key).thinking(payload.level);
          return null;
        }),
      ),
  );
  return HttpApiBuilder.layer(PagodaApi).pipe(Layer.provide(handlers));
}
