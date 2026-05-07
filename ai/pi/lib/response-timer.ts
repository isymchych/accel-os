import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;

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

export function createResponseTimerText(elapsedMs: number): string {
  return `${RESPONSE_TIMER_PREFIX}${formatElapsed(elapsedMs)}`;
}

export function createWorkingTimerMessage(elapsedMs: number): string {
  return `${WORKING_TIMER_PREFIX}${formatElapsed(elapsedMs)}`;
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
