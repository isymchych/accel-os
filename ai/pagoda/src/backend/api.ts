import { Effect, Layer, type FileSystem, type Path } from "effect";
import type { Etag, HttpPlatform, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { PagodaApi } from "../contracts/api.ts";
import type { DesktopWorkspace } from "./workspace.ts";

/** Declared errors cross HTTP directly; only commands outlive their requesting connection. */
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
  const handlers = HttpApiBuilder.group(PagodaApi, "workspace", (group) =>
    group
      .handle("workspace", () => workspace.snapshot())
      .handle("accounts", () => workspace.accounts())
      .handle("selectAccount", ({ payload }) =>
        workspace.command(workspace.selectAccount(payload.profile)).pipe(Effect.as(null)),
      )
      .handle("directory", ({ payload }) => workspace.directory(payload.cwd))
      .handle("list", ({ payload }) => workspace.list(payload.cwd))
      .handle("listAll", () => workspace.listAll())
      .handle("metadataFlag", ({ payload }) =>
        workspace
          .command(workspace.setMetadataFlag(payload.id, payload.flag, payload.value))
          .pipe(Effect.as(null)),
      )
      .handle("create", ({ payload }) => workspace.command(workspace.create(payload.cwd)))
      .handle("open", ({ payload }) => workspace.command(workspace.open(payload.cwd, payload.path)))
      .handle("snapshot", ({ payload }) =>
        workspace.session(payload.key).pipe(Effect.map((session) => session.snapshot())),
      )
      .handle("prompt", ({ payload }) => workspace.command(workspace.prompt(payload)))
      .handle("stop", ({ payload }) =>
        workspace
          .command(workspace.session(payload.key).pipe(Effect.flatMap((session) => session.stop())))
          .pipe(Effect.as(null)),
      )
      .handle("history", ({ payload }) =>
        workspace.session(payload.key).pipe(Effect.flatMap((session) => session.history())),
      )
      .handle("navigate", ({ payload }) =>
        workspace
          .command(
            workspace
              .session(payload.key)
              .pipe(Effect.flatMap((session) => session.navigate(payload.entryId))),
          )
          .pipe(Effect.map((text) => text ?? null)),
      )
      .handle("fork", ({ payload }) =>
        workspace.command(workspace.fork(payload.key, payload.entryId)),
      )
      .handle("controls", ({ payload }) =>
        workspace.session(payload.key).pipe(Effect.flatMap((session) => session.controls())),
      )
      .handle("model", ({ payload }) =>
        workspace
          .command(
            workspace
              .session(payload.key)
              .pipe(Effect.flatMap((session) => session.model(payload.provider, payload.modelId))),
          )
          .pipe(Effect.as(null)),
      )
      .handle("thinking", ({ payload }) =>
        workspace
          .command(
            workspace
              .session(payload.key)
              .pipe(Effect.flatMap((session) => session.thinking(payload.level))),
          )
          .pipe(Effect.as(null)),
      ),
  );
  return HttpApiBuilder.layer(PagodaApi).pipe(Layer.provide(handlers));
}
