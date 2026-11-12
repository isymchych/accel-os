import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import {
  ControlsSchema,
  DirectorySchema,
  EntrySchema,
  ErrorSchema,
  HistorySchema,
  MetadataFlagSchema,
  ModelSchema,
  OpenSchema,
  PromptSchema,
  SnapshotSchema,
  StoredSessionsSchema,
  TargetSchema,
  ThinkingSchema,
  WorkspaceSchema,
} from "./index.ts";

const OperationError = ErrorSchema.annotate({ httpApiStatus: 400 });

/** Shared HTTP command contract; observation remains a separate streaming boundary. */
export const PagodaApi = HttpApi.make("pagoda")
  .add(
    HttpApiGroup.make("workspace").add(
      HttpApiEndpoint.get("workspace", "/api/workspace", { success: WorkspaceSchema }),
      HttpApiEndpoint.post("directory", "/api/directory", {
        payload: DirectorySchema,
        success: Schema.String,
        error: OperationError,
      }),
      HttpApiEndpoint.post("list", "/api/list", {
        payload: DirectorySchema,
        success: StoredSessionsSchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("listAll", "/api/list-all", {
        payload: Schema.Struct({}),
        success: StoredSessionsSchema,
        error: OperationError,
      }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "ignore" }),
      HttpApiEndpoint.post("metadataFlag", "/api/metadata-flag", {
        payload: MetadataFlagSchema,
        success: Schema.Null,
        error: OperationError,
      }),
      HttpApiEndpoint.post("create", "/api/create", {
        payload: DirectorySchema,
        success: SnapshotSchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("open", "/api/open", {
        payload: OpenSchema,
        success: SnapshotSchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("snapshot", "/api/snapshot", {
        payload: TargetSchema,
        success: SnapshotSchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("prompt", "/api/prompt", {
        payload: PromptSchema,
        success: Schema.String,
        error: OperationError,
      }),
      HttpApiEndpoint.post("stop", "/api/stop", {
        payload: TargetSchema,
        success: Schema.Null,
        error: OperationError,
      }),
      HttpApiEndpoint.post("history", "/api/history", {
        payload: TargetSchema,
        success: HistorySchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("navigate", "/api/navigate", {
        payload: EntrySchema,
        success: Schema.Union([Schema.String, Schema.Null]),
        error: OperationError,
      }),
      HttpApiEndpoint.post("fork", "/api/fork", {
        payload: EntrySchema,
        success: SnapshotSchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("controls", "/api/controls", {
        payload: TargetSchema,
        success: ControlsSchema,
        error: OperationError,
      }),
      HttpApiEndpoint.post("model", "/api/model", {
        payload: ModelSchema,
        success: Schema.Null,
        error: OperationError,
      }),
      HttpApiEndpoint.post("thinking", "/api/thinking", {
        payload: ThinkingSchema,
        success: Schema.Null,
        error: OperationError,
      }),
    ),
  )
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" });
