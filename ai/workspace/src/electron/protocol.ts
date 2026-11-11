import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

// Pi owns these records; extra provider/extension fields are intentionally allowed.
export const RecordSchema = Type.Object({ type: Type.String() });
export const ResponseSchema = Type.Object({
  type: Type.Literal("response"),
  id: Type.Optional(Type.String()),
  command: Type.String(),
  success: Type.Boolean(),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
});
export const StateSchema = Type.Object({
  sessionId: Type.String(),
  isStreaming: Type.Boolean(),
  isCompacting: Type.Boolean(),
  sessionFile: Type.Optional(Type.String()),
  sessionName: Type.Optional(Type.String()),
  model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })),
  thinkingLevel: Type.Optional(Type.String()),
  pendingMessageCount: Type.Optional(Type.Number()),
});
export const CommandsSchema = Type.Object({
  commands: Type.Array(Type.Object({ name: Type.String() })),
});
export const ControlResultSchema = Type.Object({
  type: Type.Literal("workspace_result"),
  id: Type.String(),
  success: Type.Boolean(),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
});
export const ContentSchema = Type.Union([
  Type.String(),
  Type.Array(
    Type.Object({
      type: Type.String(),
      text: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      arguments: Type.Optional(Type.Unknown()),
    }),
  ),
]);
const ContentMessageSchema = Type.Object({
  role: Type.String(),
  content: ContentSchema,
  isError: Type.Optional(Type.Boolean()),
  errorMessage: Type.Optional(Type.String()),
  stopReason: Type.Optional(Type.String()),
  toolName: Type.Optional(Type.String()),
});
const BashMessageSchema = Type.Object({
  role: Type.Literal("bashExecution"),
  command: Type.String(),
  output: Type.String(),
  exitCode: Type.Optional(Type.Number()),
  cancelled: Type.Optional(Type.Boolean()),
});
const SummaryMessageSchema = Type.Object({
  role: Type.Union([Type.Literal("compactionSummary"), Type.Literal("branchSummary")]),
  summary: Type.String(),
});
export const MessageSchema = Type.Union([
  ContentMessageSchema,
  BashMessageSchema,
  SummaryMessageSchema,
]);
export const MessagesSchema = Type.Object({ messages: Type.Array(MessageSchema) });
export const MessageEndSchema = Type.Object({
  type: Type.Literal("message_end"),
  message: MessageSchema,
});
export const DeltaSchema = Type.Object({
  type: Type.Literal("message_update"),
  assistantMessageEvent: Type.Object({
    type: Type.String(),
    delta: Type.Optional(Type.String()),
  }),
});
export const ToolSchema = Type.Object({
  type: Type.String(),
  toolName: Type.String(),
  toolCallId: Type.String(),
  args: Type.Optional(Type.Unknown()),
  partialResult: Type.Optional(Type.Unknown()),
  result: Type.Optional(Type.Unknown()),
  isError: Type.Optional(Type.Boolean()),
});
export const CatalogSchema = Type.Array(
  Type.Object({
    path: Type.String(),
    id: Type.String(),
    cwd: Type.String(),
    name: Type.String(),
    modified: Type.String(),
  }),
);
export const EntriesSchema = Type.Object({
  entries: Type.Array(
    Type.Object({
      id: Type.String(),
      parentId: Type.Union([Type.String(), Type.Null()]),
      type: Type.String(),
      message: Type.Optional(MessageSchema),
      summary: Type.Optional(Type.String()),
    }),
  ),
  leafId: Type.Union([Type.String(), Type.Null()]),
});
export const ModelsSchema = Type.Object({
  models: Type.Array(
    Type.Object({ provider: Type.String(), id: Type.String(), name: Type.String() }),
  ),
});
export const LevelsSchema = Type.Object({ levels: Type.Array(Type.String()) });
export const PathSchema = Type.Object({ path: Type.String() });
export const NavigationSchema = Type.Object({
  cancelled: Type.Boolean(),
  editorText: Type.Optional(Type.String()),
});
export const DispositionSchema = Type.Object({ disposition: Type.String() });
export const UiSchema = Type.Object({
  type: Type.Literal("extension_ui_request"),
  id: Type.String(),
  method: Type.String(),
  message: Type.Optional(Type.String()),
});
export const ExtensionErrorSchema = Type.Object({
  type: Type.Literal("extension_error"),
  error: Type.String(),
});

export type PiMessage = Static<typeof MessageSchema>;
export type PiResponse = Static<typeof ResponseSchema>;
export type PiRecord = Static<typeof RecordSchema>;

export function parseRecord(line: string): PiRecord {
  const value: unknown = JSON.parse(line);
  if (!Value.Check(RecordSchema, value)) throw new Error("Invalid Pi RPC record");
  return value;
}
