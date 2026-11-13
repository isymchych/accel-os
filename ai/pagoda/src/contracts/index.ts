import { Schema } from "effect";

const Key = Schema.String.check(Schema.isMinLength(1));
const SessionKeySchema = Key.pipe(Schema.brand("SessionKey"));
const HistoryEntryIdSchema = Key.pipe(Schema.brand("HistoryEntryId"));
const SessionIdSchema = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionKey = typeof SessionKeySchema.Type;
export type SessionId = typeof SessionIdSchema.Type;
export type HistoryEntryId = typeof HistoryEntryIdSchema.Type;
const Path = Schema.String.check(Schema.isMinLength(1));
export const TargetSchema = Schema.Struct({ key: SessionKeySchema });
export const DirectorySchema = Schema.Struct({ cwd: Path });
export const OpenSchema = Schema.Struct({ cwd: Path, path: Path });
export const MetadataFlagSchema = Schema.Struct({
  id: SessionIdSchema,
  flag: Schema.Union([Schema.Literal("pinned"), Schema.Literal("favourite")]),
  value: Schema.Boolean,
});
export const EntrySchema = Schema.Struct({
  key: SessionKeySchema,
  entryId: HistoryEntryIdSchema,
});
export const PromptSchema = Schema.Struct({
  key: SessionKeySchema,
  message: Schema.String.check(Schema.isMinLength(1)),
  mode: Schema.Union([
    Schema.Literal("prompt"),
    Schema.Literal("follow_up"),
    Schema.Literal("steer"),
  ]),
});
export const ModelSchema = Schema.Struct({
  key: SessionKeySchema,
  provider: Key,
  modelId: Key,
});
export const ThinkingSchema = Schema.Struct({
  key: SessionKeySchema,
  level: Schema.String.check(Schema.isMinLength(1)),
});

// HTTP JSON and SSE are external boundaries. Derive the presentation types from
// their schemas so the wire contract and the client checks cannot drift apart.
export const ImageBlockSchema = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String.check(Schema.isPattern(/^image\/(png|jpeg|gif|webp)$/u)),
});
const ContentBlockSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thinking"), text: Schema.String }),
  ImageBlockSchema,
]);
const TranscriptMessageSchema = Schema.Struct({
  role: Schema.String,
  content: Schema.Array(ContentBlockSchema),
  isError: Schema.Boolean,
});
const ToolActivitySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  arguments: Schema.String,
  content: Schema.Array(ContentBlockSchema),
  state: Schema.Union([
    Schema.Literal("running"),
    Schema.Literal("completed"),
    Schema.Literal("error"),
  ]),
});
export const SummarySchema = Schema.Struct({
  /** Routes commands and observations to the current execution owner. */
  key: SessionKeySchema,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  connection: Schema.Union([
    Schema.Literal("starting"),
    Schema.Literal("connected"),
    Schema.Literal("disconnected"),
  ]),
  execution: Schema.Union([
    Schema.Literal("idle"),
    Schema.Literal("running"),
    Schema.Literal("stopping"),
    Schema.Literal("unknown"),
  ]),
  cwd: Schema.String,
  sessionId: Schema.Union([SessionIdSchema, Schema.Null]),
  sessionFile: Schema.Union([Schema.String, Schema.Null]),
  name: Schema.String,
});
/** A copy of backend-owned live presentation state. */
export const SnapshotSchema = Schema.Struct({
  ...SummarySchema.fields,
  controlsRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  historyRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  messages: Schema.Array(TranscriptMessageSchema),
  streaming: Schema.Array(ContentBlockSchema),
  tools: Schema.Array(ToolActivitySchema),
  activity: Schema.Union([Schema.String, Schema.Null]),
  error: Schema.Union([Schema.String, Schema.Null]),
  notice: Schema.Union([Schema.String, Schema.Null]),
});
const { key: _key, revision: _revision, ...snapshotChangeFields } = SnapshotSchema.fields;
// Object.fromEntries preserves these keys and only changes each field's optionality.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const optionalSnapshotChangeFields = Object.fromEntries(
  Object.entries(snapshotChangeFields).map(([key, field]) => [key, Schema.optionalKey(field)]),
) as {
  readonly [K in keyof typeof snapshotChangeFields]: Schema.optionalKey<
    (typeof snapshotChangeFields)[K]
  >;
};
export const SnapshotUpdateSchema = Schema.Struct({
  key: SnapshotSchema.fields.key,
  revision: SnapshotSchema.fields.revision,
  changes: Schema.Struct(optionalSnapshotChangeFields),
});
export const SessionMetadataSchema = Schema.Struct({
  id: SessionIdSchema,
  pinned: Schema.Boolean,
  favourite: Schema.Boolean,
});
export const MetadataSchema = Schema.Array(SessionMetadataSchema);
export const AccountsSchema = Schema.Array(
  Schema.Struct({
    profile: Schema.String,
    accountId: Schema.optionalKey(Schema.String),
    email: Schema.optionalKey(Schema.String),
    plan: Schema.optionalKey(Schema.String),
  }),
);
export const AccountSelectionSchema = Schema.Struct({ profile: Key });
export const SelectedAccountSchema = Schema.Union([Schema.String, Schema.Null]);
export const WorkspaceSchema = Schema.Struct({
  initialKey: SessionKeySchema,
  sessions: Schema.Array(SnapshotSchema),
  metadata: MetadataSchema,
  selectedAccount: SelectedAccountSchema,
  inactivityHours: Schema.Number.check(Schema.isGreaterThan(0)),
});
const StoredSessionSchema = Schema.Struct({
  path: Schema.String,
  id: SessionIdSchema,
  cwd: Schema.String,
  name: Schema.String,
  modified: Schema.String,
});
export const StoredSessionsSchema = Schema.Array(StoredSessionSchema);
const HistoryEntrySchema = Schema.Struct({
  id: HistoryEntryIdSchema,
  parentId: Schema.Union([HistoryEntryIdSchema, Schema.Null]),
  label: Schema.String,
});
export const HistorySchema = Schema.Struct({
  entries: Schema.Array(HistoryEntrySchema),
  leafId: Schema.Union([HistoryEntryIdSchema, Schema.Null]),
});
const ModelChoiceSchema = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  name: Schema.String,
});
export const ControlsSchema = Schema.Struct({
  models: Schema.Array(ModelChoiceSchema),
  model: Schema.Union([Schema.Struct({ provider: Schema.String, id: Schema.String }), Schema.Null]),
  thinkingLevel: Schema.String,
  levels: Schema.Array(Schema.String),
  pendingMessageCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const ErrorSchema = Schema.Struct({ error: Schema.String });

export type Prompt = typeof PromptSchema.Type;
export type ContentBlock = typeof ContentBlockSchema.Type;
export type TranscriptMessage = typeof TranscriptMessageSchema.Type;
export type ToolActivity = typeof ToolActivitySchema.Type;
export type SessionSummary = typeof SummarySchema.Type;
export type SessionSnapshot = typeof SnapshotSchema.Type;
export type SessionUpdate = typeof SnapshotUpdateSchema.Type;
export type WorkspaceState = typeof WorkspaceSchema.Type;
export type SessionMetadata = typeof SessionMetadataSchema.Type;
export type Account = (typeof AccountsSchema.Type)[number];
export type StoredSession = typeof StoredSessionSchema.Type;
export type HistoryEntry = typeof HistoryEntrySchema.Type;
export type SessionHistory = typeof HistorySchema.Type;
export type ModelChoice = typeof ModelChoiceSchema.Type;
export type SessionControls = typeof ControlsSchema.Type;

export type WorkspaceObservation =
  | { type: "workspace"; workspace: WorkspaceState }
  | { type: "snapshot"; snapshot: SessionSnapshot }
  | { type: "account"; profile: string | null }
  | { type: "metadata"; metadata: readonly SessionMetadata[] };

export interface WorkspaceApi {
  accounts(): Promise<readonly Account[]>;
  selectAccount(profile: string): Promise<void>;
  directory(cwd: string): Promise<string>;
  list(cwd: string): Promise<readonly StoredSession[]>;
  listAll(): Promise<readonly StoredSession[]>;
  setMetadataFlag(id: SessionId, flag: "pinned" | "favourite", value: boolean): Promise<void>;
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
