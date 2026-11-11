import { Type, type Static } from "typebox";

const Key = Type.String({ minLength: 1, maxLength: 200 });
const Path = Type.String({ minLength: 1, maxLength: 32_768 });
export const TargetSchema = Type.Object({ key: Key }, { additionalProperties: false });
export const DirectorySchema = Type.Object({ cwd: Path }, { additionalProperties: false });
export const OpenSchema = Type.Object({ cwd: Path, path: Path }, { additionalProperties: false });
export const EntrySchema = Type.Object({ key: Key, entryId: Key }, { additionalProperties: false });
export const PromptSchema = Type.Object(
  {
    key: Key,
    message: Type.String({ minLength: 1, maxLength: 100_000 }),
    mode: Type.Union([Type.Literal("prompt"), Type.Literal("follow_up"), Type.Literal("steer")]),
  },
  { additionalProperties: false },
);
export const ModelSchema = Type.Object(
  {
    key: Key,
    provider: Key,
    modelId: Key,
  },
  { additionalProperties: false },
);
export const ThinkingSchema = Type.Object(
  {
    key: Key,
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
  key: string;
  revision: number;
  connection: "starting" | "connected" | "disconnected";
  execution: "idle" | "running" | "stopping" | "unknown";
  cwd: string;
  sessionId: string | null;
  sessionFile: string | null;
  name: string;
}
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
  id: string;
  cwd: string;
  name: string;
  modified: string;
}
export interface HistoryEntry {
  id: string;
  parentId: string | null;
  label: string;
}
export interface SessionHistory {
  entries: HistoryEntry[];
  leafId: string | null;
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
  workspace(): Promise<{ initialKey: string; sessions: SessionSummary[] }>;
  chooseDirectory(): Promise<string | null>;
  list(cwd: string): Promise<StoredSession[]>;
  create(cwd: string): Promise<SessionSnapshot>;
  open(cwd: string, path: string): Promise<SessionSnapshot>;
  snapshot(key: string): Promise<SessionSnapshot>;
  prompt(request: Prompt): Promise<string>;
  stop(key: string): Promise<void>;
  history(key: string): Promise<SessionHistory>;
  navigate(key: string, entryId: string): Promise<string | undefined>;
  fork(key: string, entryId: string): Promise<SessionSnapshot>;
  controls(key: string): Promise<SessionControls>;
  model(key: string, provider: string, modelId: string): Promise<void>;
  thinking(key: string, level: string): Promise<void>;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
}
