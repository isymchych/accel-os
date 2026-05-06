/**
 * Shows a live response timer in Pi's working row while the agent is working,
 * then appends the final elapsed time to the finalized assistant reply.
 *
 * The appended timer is stripped from future LLM context so it stays UI-only.
 */
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const UPDATE_INTERVAL_MS = 200;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;
const TIMER_PREFIX = "\n\n⏱ ";

function formatElapsed(ms: number): string {
  if (ms < MINUTE_MS) {
    return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}m ${seconds}s`;
}

function createTimerText(elapsedMs: number): string {
  return `${TIMER_PREFIX}${formatElapsed(elapsedMs)}`;
}

function isTimerTextContent(content: AssistantMessage["content"][number]): content is TextContent {
  return content.type === "text" && content.text.startsWith(TIMER_PREFIX);
}

function stripTimerFromMessage(message: AgentMessage): AgentMessage {
  if (message.role !== "assistant") {
    return message;
  }

  const content = [...message.content];
  const lastContent = content.at(-1);
  if (lastContent === undefined || !isTimerTextContent(lastContent)) {
    return message;
  }

  return {
    ...message,
    content: content.slice(0, -1),
  };
}

export default function responseTimerExtension(pi: ExtensionAPI): void {
  let startedAt: number | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  const clearIntervalIfRunning = (): void => {
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const updateWorkingMessage = (setWorkingMessage: (text?: string) => void): void => {
    if (startedAt === undefined) {
      return;
    }

    setWorkingMessage(`resp ${formatElapsed(Date.now() - startedAt)}`);
  };

  pi.on("context", (event) => ({
    messages: event.messages.map((message) => stripTimerFromMessage(message)),
  }));

  pi.on("session_start", (_event, ctx) => {
    clearIntervalIfRunning();
    startedAt = undefined;
    ctx.ui.setWorkingMessage();
  });

  pi.on("agent_start", (_event, ctx) => {
    clearIntervalIfRunning();
    startedAt = Date.now();
    updateWorkingMessage(ctx.ui.setWorkingMessage.bind(ctx.ui));
    interval = setInterval(() => {
      updateWorkingMessage(ctx.ui.setWorkingMessage.bind(ctx.ui));
    }, UPDATE_INTERVAL_MS);
  });

  pi.on("message_end", (event) => {
    if (
      startedAt === undefined ||
      event.message.role !== "assistant" ||
      event.message.stopReason === "toolUse"
    ) {
      return undefined;
    }

    return {
      message: {
        ...event.message,
        content: [
          ...event.message.content,
          {
            type: "text",
            text: createTimerText(Date.now() - startedAt),
          },
        ],
      },
    };
  });

  pi.on("agent_end", (_event, ctx) => {
    startedAt = undefined;
    ctx.ui.setWorkingMessage();
    clearIntervalIfRunning();
  });

  pi.on("session_shutdown", () => {
    clearIntervalIfRunning();
  });
}
