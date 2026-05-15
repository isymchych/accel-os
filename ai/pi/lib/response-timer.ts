import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;
const ESTIMATED_CHARS_PER_TOKEN = 4;

export const RESPONSE_TIMER_PREFIX = "\n\n⏱ ";
export const WORKING_TIMER_PREFIX = "⏱ ";

export function formatElapsed(ms: number): string {
  if (ms < MINUTE_MS) {
    return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}m ${seconds}s`;
}

function formatTokensPerSecond(outputTokens: number, elapsedMs: number): number | undefined {
  if (outputTokens <= 0 || elapsedMs <= 0) {
    return undefined;
  }

  return Math.round(outputTokens / (elapsedMs / MS_PER_SECOND));
}

export function estimateTokensFromTextDelta(delta: string): number {
  return Math.max(0, delta.length / ESTIMATED_CHARS_PER_TOKEN);
}

export function createWorkingTimerMessage(
  elapsedMs: number,
  tps?: {
    estimated: boolean;
    outputTokens: number;
    streamElapsedMs: number;
  },
): string {
  const elapsed = `${WORKING_TIMER_PREFIX}${formatElapsed(elapsedMs)}`;
  if (tps === undefined) {
    return elapsed;
  }

  const tokensPerSecond = formatTokensPerSecond(tps.outputTokens, tps.streamElapsedMs);
  if (tokensPerSecond === undefined) {
    return elapsed;
  }

  const prefix = tps.estimated ? "~" : "";
  return `${elapsed} · ${prefix}${tokensPerSecond} tok/s`;
}

export function createTotalElapsedSummary(elapsedMs: number): string {
  return `${WORKING_TIMER_PREFIX}${formatElapsed(elapsedMs)}`;
}

export function createCompletedTimerSummary(
  elapsedMs: number,
  tps?: {
    outputTokens: number;
    streamElapsedMs: number;
  },
): string {
  const summaryParts = [createTotalElapsedSummary(elapsedMs)];
  if (tps === undefined) {
    return summaryParts.join(" · ");
  }

  const tokensPerSecond = formatTokensPerSecond(tps.outputTokens, tps.streamElapsedMs);
  if (tokensPerSecond === undefined) {
    return summaryParts.join(" · ");
  }

  summaryParts.push(`${tokensPerSecond} tok/s`);
  summaryParts.push(`${tps.outputTokens} tokens`);
  return summaryParts.join(" · ");
}

function isResponseTimerTextContent(
  content: AssistantMessage["content"][number],
): content is TextContent {
  return content.type === "text" && content.text.startsWith(RESPONSE_TIMER_PREFIX);
}

export function stripResponseTimerFromMessage(message: AgentMessage): AgentMessage {
  if (message.role !== "assistant") {
    return message;
  }

  const content = [...message.content];
  const lastContent = content.at(-1);
  if (lastContent === undefined || !isResponseTimerTextContent(lastContent)) {
    return message;
  }

  return {
    ...message,
    content: content.slice(0, -1),
  };
}
