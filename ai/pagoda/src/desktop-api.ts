import { Type, type Static } from "typebox";

import type { Brand } from "./lib/brand.ts";

export type SessionKey = Brand<string, "SessionKey">;
export type SessionId = Brand<string, "SessionId">;
export type HistoryEntryId = Brand<string, "HistoryEntryId">;

const Key = Type.String({ minLength: 1, maxLength: 200 });
const SessionKeySchema = Type.Unsafe<SessionKey>(Key);
const HistoryEntryIdSchema = Type.Unsafe<HistoryEntryId>(Key);
const SessionIdSchema = Type.Unsafe<SessionId>(Type.String());
const Path = Type.String({ minLength: 1, maxLength: 32_768 });
export const TargetSchema = Type.Object({ key: SessionKeySchema }, { additionalProperties: false });
export const DirectorySchema = Type.Object({ cwd: Path }, { additionalProperties: false });
export const OpenSchema = Type.Object({ cwd: Path, path: Path }, { additionalProperties: false });
export const EntrySchema = Type.Object(
  { key: SessionKeySchema, entryId: HistoryEntryIdSchema },
  { additionalProperties: false },
);
export const PromptSchema = Type.Object(
  {
    key: SessionKeySchema,
    message: Type.String({ minLength: 1, maxLength: 100_000 }),
    mode: Type.Union([Type.Literal("prompt"), Type.Literal("follow_up"), Type.Literal("steer")]),
  },
  { additionalProperties: false },
);
export const ModelSchema = Type.Object(
  { key: SessionKeySchema, provider: Key, modelId: Key },
  { additionalProperties: false },
);
export const ThinkingSchema = Type.Object(
  { key: SessionKeySchema, level: Type.String({ minLength: 1, maxLength: 30 }) },
  { additionalProperties: false },
);

// HTTP JSON and SSE are external boundaries. Derive the presentation types from
// their schemas so the wire contract and the client checks cannot drift apart.
export const ImageBlockSchema = Type.Object({
  type: Type.Literal("image"),
  data: Type.String(),
  mimeType: Type.String({ pattern: "^image/(png|jpeg|gif|webp)$" }),
});
const ContentBlockSchema = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String() }),
  Type.Object({ type: Type.Literal("thinking"), text: Type.String() }),
  ImageBlockSchema,
]);
const TranscriptMessageSchema = Type.Object({
  role: Type.String(),
  content: Type.Array(ContentBlockSchema),
  isError: Type.Boolean(),
});
const ToolActivitySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  arguments: Type.String(),
  content: Type.Array(ContentBlockSchema),
  state: Type.Union([Type.Literal("running"), Type.Literal("completed"), Type.Literal("error")]),
});
export const SummarySchema = Type.Object({
  /** Routes commands and observations to the current execution owner. */
  key: SessionKeySchema,
  revision: Type.Integer({ minimum: 0 }),
  connection: Type.Union([
    Type.Literal("starting"),
    Type.Literal("connected"),
    Type.Literal("disconnected"),
  ]),
  execution: Type.Union([
    Type.Literal("idle"),
    Type.Literal("running"),
    Type.Literal("stopping"),
    Type.Literal("unknown"),
  ]),
  cwd: Type.String(),
  sessionId: Type.Union([SessionIdSchema, Type.Null()]),
  sessionFile: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
});
/** A copy of backend-owned live presentation state. */
export const SnapshotSchema = Type.Object({
  ...SummarySchema.properties,
  controlsRevision: Type.Integer({ minimum: 0 }),
  historyRevision: Type.Integer({ minimum: 0 }),
  messages: Type.Array(TranscriptMessageSchema),
  streaming: Type.Array(ContentBlockSchema),
  tools: Type.Array(ToolActivitySchema),
  activity: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  notice: Type.Union([Type.String(), Type.Null()]),
});
export const WorkspaceSchema = Type.Object({
  initialKey: SessionKeySchema,
  sessions: Type.Array(SnapshotSchema),
});
const StoredSessionSchema = Type.Object({
  path: Type.String(),
  id: SessionIdSchema,
  cwd: Type.String(),
  name: Type.String(),
  modified: Type.String(),
});
export const StoredSessionsSchema = Type.Array(StoredSessionSchema);
const HistoryEntrySchema = Type.Object({
  id: HistoryEntryIdSchema,
  parentId: Type.Union([HistoryEntryIdSchema, Type.Null()]),
  label: Type.String(),
});
export const HistorySchema = Type.Object({
  entries: Type.Array(HistoryEntrySchema),
  leafId: Type.Union([HistoryEntryIdSchema, Type.Null()]),
});
const ModelChoiceSchema = Type.Object({
  provider: Type.String(),
  id: Type.String(),
  name: Type.String(),
});
export const ControlsSchema = Type.Object({
  models: Type.Array(ModelChoiceSchema),
  model: Type.Union([Type.Object({ provider: Type.String(), id: Type.String() }), Type.Null()]),
  thinkingLevel: Type.String(),
  levels: Type.Array(Type.String()),
  pendingMessageCount: Type.Integer({ minimum: 0 }),
});
export const ErrorSchema = Type.Object({ error: Type.String() });

export type Prompt = Static<typeof PromptSchema>;
export type ContentBlock = Static<typeof ContentBlockSchema>;
export type TranscriptMessage = Static<typeof TranscriptMessageSchema>;
export type ToolActivity = Static<typeof ToolActivitySchema>;
export type SessionSummary = Static<typeof SummarySchema>;
export type SessionSnapshot = Static<typeof SnapshotSchema>;
export type WorkspaceState = Static<typeof WorkspaceSchema>;
export type StoredSession = Static<typeof StoredSessionSchema>;
export type HistoryEntry = Static<typeof HistoryEntrySchema>;
export type SessionHistory = Static<typeof HistorySchema>;
export type ModelChoice = Static<typeof ModelChoiceSchema>;
export type SessionControls = Static<typeof ControlsSchema>;

export type WorkspaceObservation =
  | { type: "workspace"; workspace: WorkspaceState }
  | { type: "snapshot"; snapshot: SessionSnapshot };

export interface WorkspaceApi {
  directory(cwd: string): Promise<string>;
  list(cwd: string): Promise<StoredSession[]>;
  create(cwd: string): Promise<SessionSnapshot>;
  open(cwd: string, path: string): Promise<SessionSnapshot>;
  prompt(request: Prompt): Promise<string>;
  stop(key: SessionKey): Promise<void>;
  history(key: SessionKey): Promise<SessionHistory>;
  navigate(key: SessionKey, entryId: HistoryEntryId): Promise<string | undefined>;
  fork(key: SessionKey, entryId: HistoryEntryId): Promise<SessionSnapshot>;
  controls(key: SessionKey): Promise<SessionControls>;
  model(key: SessionKey, provider: string, modelId: string): Promise<void>;
  thinking(key: SessionKey, level: string): Promise<void>;
  subscribe(
    listener: (observation: WorkspaceObservation) => void,
    connection?: (connected: boolean) => void,
  ): () => void;
}
