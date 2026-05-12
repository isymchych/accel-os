import { isRecord } from "./guards.ts";

export type VerbosityLevel = "low" | "medium" | "high";
export type VerbositySelection = VerbosityLevel | "default";

export interface PersistedVerbosityState {
  level: VerbosityLevel | null;
}

export const OPENAI_CODEX_VERBOSITY_ENTRY_TYPE = "openai-codex-verbosity";

// Defaults copied from OpenAI Codex source: codex-rs/models-manager/models.json.
export const DEFAULT_VERBOSITY_BY_MODEL: Readonly<Record<string, VerbosityLevel>> = {
  "gpt-5.5": "low",
  "gpt-5.4": "low",
  "gpt-5.4-mini": "medium",
  "gpt-5.3-codex": "low",
  "gpt-5.2": "low",
  "codex-auto-review": "low",
};

const VERBOSITY_LEVELS = ["low", "medium", "high"] as const satisfies readonly VerbosityLevel[];
const VERBOSITY_SELECTIONS = [
  "low",
  "medium",
  "high",
  "default",
] as const satisfies readonly VerbositySelection[];

export function isVerbosityLevel(value: unknown): value is VerbosityLevel {
  return typeof value === "string" && (VERBOSITY_LEVELS as readonly string[]).includes(value);
}

export function isVerbositySelection(value: unknown): value is VerbositySelection {
  return typeof value === "string" && (VERBOSITY_SELECTIONS as readonly string[]).includes(value);
}

export function getVerbositySelections(): readonly VerbositySelection[] {
  return VERBOSITY_SELECTIONS;
}

export function readPersistedVerbosityState(value: unknown): VerbosityLevel | null | undefined {
  if (!isRecord(value) || !("level" in value)) {
    return undefined;
  }

  const level = value["level"];
  if (level === null) {
    return null;
  }

  return isVerbosityLevel(level) ? level : undefined;
}

export function resolveOpenAICodexVerbosity(
  modelId: string,
  sessionOverride: VerbosityLevel | undefined,
): VerbosityLevel | undefined {
  if (sessionOverride !== undefined) {
    return sessionOverride;
  }
  return DEFAULT_VERBOSITY_BY_MODEL[modelId];
}

export function applyVerbosityToOpenAIResponsesPayload(
  payload: unknown,
  verbosity: VerbosityLevel,
): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }

  const nextText = isRecord(payload["text"]) ? { ...payload["text"], verbosity } : { verbosity };

  return {
    ...payload,
    text: nextText,
  };
}
