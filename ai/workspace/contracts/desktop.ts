import { Type, type Static } from "typebox";

export const PromptSchema = Type.Object(
  { message: Type.String({ minLength: 1, maxLength: 100_000 }) },
  { additionalProperties: false },
);

export interface TranscriptMessage {
  role: string;
  text: string;
  isError: boolean;
}

export interface SessionSnapshot {
  revision: number;
  connection: "starting" | "connected" | "disconnected";
  execution: "idle" | "running" | "stopping" | "unknown";
  cwd: string;
  sessionId: string | null;
  messages: TranscriptMessage[];
  streaming: string;
  activity: string | null;
  error: string | null;
  notice: string | null;
}

export type Prompt = Static<typeof PromptSchema>;

export interface DesktopApi {
  snapshot(): Promise<SessionSnapshot>;
  prompt(request: Prompt): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
}
