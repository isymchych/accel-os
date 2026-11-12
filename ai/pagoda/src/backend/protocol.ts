import { Schema } from "effect";

// Pi owns these records; extra provider/extension fields are intentionally allowed.
const SessionIdSchema = Schema.String.pipe(Schema.brand("SessionId"));
const HistoryEntryIdSchema = Schema.String.pipe(Schema.brand("HistoryEntryId"));
export const RecordSchema = Schema.Struct({ type: Schema.String });
export const ResponseSchema = Schema.Struct({
  type: Schema.Literal("response"),
  id: Schema.optionalKey(Schema.String),
  command: Schema.String,
  success: Schema.Boolean,
  data: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
});
export const StateSchema = Schema.Struct({
  sessionId: SessionIdSchema,
  isStreaming: Schema.Boolean,
  isCompacting: Schema.Boolean,
  sessionFile: Schema.optionalKey(Schema.String),
  sessionName: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.Struct({ provider: Schema.String, id: Schema.String })),
  thinkingLevel: Schema.optionalKey(Schema.String),
  pendingMessageCount: Schema.optionalKey(Schema.Number),
});
export const CommandsSchema = Schema.Struct({
  commands: Schema.Array(Schema.Struct({ name: Schema.String })),
});
export const ControlResultSchema = Schema.Struct({
  type: Schema.Literal("workspace_result"),
  id: Schema.String,
  success: Schema.Boolean,
  data: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
});
export const ContentSchema = Schema.Union([
  Schema.String,
  Schema.Array(
    Schema.Struct({
      type: Schema.String,
      text: Schema.optionalKey(Schema.String),
      thinking: Schema.optionalKey(Schema.String),
      data: Schema.optionalKey(Schema.String),
      mimeType: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
      arguments: Schema.optionalKey(Schema.Unknown),
    }),
  ),
]);
const ContentMessageSchema = Schema.Struct({
  role: Schema.String,
  content: ContentSchema,
  isError: Schema.optionalKey(Schema.Boolean),
  errorMessage: Schema.optionalKey(Schema.String),
  stopReason: Schema.optionalKey(Schema.String),
  toolName: Schema.optionalKey(Schema.String),
});
const BashMessageSchema = Schema.Struct({
  role: Schema.Literal("bashExecution"),
  command: Schema.String,
  output: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
  cancelled: Schema.optionalKey(Schema.Boolean),
});
const SummaryMessageSchema = Schema.Struct({
  role: Schema.Union([Schema.Literal("compactionSummary"), Schema.Literal("branchSummary")]),
  summary: Schema.String,
});
export const MessageSchema = Schema.Union([
  ContentMessageSchema,
  BashMessageSchema,
  SummaryMessageSchema,
]);
export const MessagesSchema = Schema.Struct({ messages: Schema.Array(MessageSchema) });
export const MessageEndSchema = Schema.Struct({
  type: Schema.Literal("message_end"),
  message: MessageSchema,
});
export const DeltaSchema = Schema.Struct({
  type: Schema.Literal("message_update"),
  assistantMessageEvent: Schema.Struct({
    type: Schema.String,
    delta: Schema.optionalKey(Schema.String),
    content: Schema.optionalKey(Schema.String),
    contentIndex: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
});
export const ToolSchema = Schema.Struct({
  type: Schema.String,
  toolName: Schema.String,
  toolCallId: Schema.String,
  args: Schema.optionalKey(Schema.Unknown),
  partialResult: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  isError: Schema.optionalKey(Schema.Boolean),
});
export const CatalogSchema = Schema.Array(
  Schema.Struct({
    path: Schema.String,
    id: SessionIdSchema,
    cwd: Schema.String,
    name: Schema.String,
    modified: Schema.String,
  }),
);
export const EntriesSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      id: HistoryEntryIdSchema,
      parentId: Schema.Union([HistoryEntryIdSchema, Schema.Null]),
      type: Schema.String,
      message: Schema.optionalKey(MessageSchema),
      summary: Schema.optionalKey(Schema.String),
    }),
  ),
  leafId: Schema.Union([HistoryEntryIdSchema, Schema.Null]),
});
export const ModelsSchema = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({ provider: Schema.String, id: Schema.String, name: Schema.String }),
  ),
});
export const LevelsSchema = Schema.Struct({ levels: Schema.Array(Schema.String) });
export const PathSchema = Schema.Struct({ path: Schema.String });
export const NavigationSchema = Schema.Struct({
  cancelled: Schema.Boolean,
  editorText: Schema.optionalKey(Schema.String),
});
export const DispositionSchema = Schema.Struct({ disposition: Schema.String });
export const UiSchema = Schema.Struct({
  type: Schema.Literal("extension_ui_request"),
  id: Schema.String,
  method: Schema.String,
  message: Schema.optionalKey(Schema.String),
});
export const ExtensionErrorSchema = Schema.Struct({
  type: Schema.Literal("extension_error"),
  error: Schema.String,
});

export type PiMessage = typeof MessageSchema.Type;
export type PiResponse = typeof ResponseSchema.Type;
export type PiRecord = typeof RecordSchema.Type;

export function parseRecord(line: string): PiRecord {
  const value: unknown = JSON.parse(line);
  if (!Schema.is(RecordSchema)(value)) throw new Error("Invalid Pi RPC record");
  return value;
}
