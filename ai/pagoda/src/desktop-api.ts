import { Type, type Static } from "typebox";

import type { Brand } from "./lib/brand.ts";

export type SessionKey = Brand<string, "SessionKey">;
export type SessionId = Brand<string, "SessionId">;
export type HistoryEntryId = Brand<string, "HistoryEntryId">;

const Key = Type.String({ minLength: 1, maxLength: 200 });
const SessionKeySchema = Type.Unsafe<SessionKey>(Key);
const HistoryEntryIdSchema = Type.Unsafe<HistoryEntryId>(Key);
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
  {
    key: SessionKeySchema,
    provider: Key,
    modelId: Key,
  },
  { additionalProperties: false },
);
export const ThinkingSchema = Type.Object(
  {
    key: SessionKeySchema,
    level: Type.String({ minLength: 1, maxLength: 30 }),
  },
  { additionalProperties: false },
);

export interface TranscriptMessage {
  role: string;
  text: string;
  isError: boolean;
}
export interface ToolActivity {
  id: string;
  name: string;
  arguments: string;
  output: string;
  state: "running" | "completed" | "error";
}
export interface SessionSummary {
  /** Routes commands and observations to the current execution owner. */
  key: SessionKey;
  revision: number;
  connection: "starting" | "connected" | "disconnected";
  execution: "idle" | "running" | "stopping" | "unknown";
  cwd: string;
  sessionId: SessionId | null;
  sessionFile: string | null;
  name: string;
}
/** A copy of live presentation state for the renderer. */
export interface SessionSnapshot extends SessionSummary {
  messages: TranscriptMessage[];
  streaming: string;
  tools: ToolActivity[];
  activity: string | null;
  error: string | null;
  notice: string | null;
}
export interface StoredSession {
  path: string;
  id: SessionId;
  cwd: string;
  name: string;
  modified: string;
}
export interface HistoryEntry {
  id: HistoryEntryId;
  parentId: HistoryEntryId | null;
  label: string;
}
export interface SessionHistory {
  entries: HistoryEntry[];
  leafId: HistoryEntryId | null;
}
export interface ModelChoice {
  provider: string;
  id: string;
  name: string;
}
export interface SessionControls {
  models: ModelChoice[];
  model: { provider: string; id: string } | null;
  thinkingLevel: string;
  levels: string[];
  pendingMessageCount: number;
}
export type Prompt = Static<typeof PromptSchema>;
export interface DesktopApi {
  workspace(): Promise<{ initialKey: SessionKey; sessions: SessionSummary[] }>;
  chooseDirectory(): Promise<string | null>;
  list(cwd: string): Promise<StoredSession[]>;
  create(cwd: string): Promise<SessionSnapshot>;
  open(cwd: string, path: string): Promise<SessionSnapshot>;
  snapshot(key: SessionKey): Promise<SessionSnapshot>;
  prompt(request: Prompt): Promise<string>;
  stop(key: SessionKey): Promise<void>;
  history(key: SessionKey): Promise<SessionHistory>;
  navigate(key: SessionKey, entryId: HistoryEntryId): Promise<string | undefined>;
  fork(key: SessionKey, entryId: HistoryEntryId): Promise<SessionSnapshot>;
  controls(key: SessionKey): Promise<SessionControls>;
  model(key: SessionKey, provider: string, modelId: string): Promise<void>;
  thinking(key: SessionKey, level: string): Promise<void>;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
}
