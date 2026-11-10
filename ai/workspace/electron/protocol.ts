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
});
const ContentSchema = Type.Union([
  Type.String(),
  Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
]);
export const MessageSchema = Type.Object({
  role: Type.String(),
  content: ContentSchema,
  isError: Type.Optional(Type.Boolean()),
  errorMessage: Type.Optional(Type.String()),
  stopReason: Type.Optional(Type.String()),
});
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
export const ToolSchema = Type.Object({ type: Type.String(), toolName: Type.String() });
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
