import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "response-timer";
const UPDATE_INTERVAL_MS = 200;

function formatElapsed(ms: number): string {
  if (ms < 60_000) {
    return `resp ${(ms / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `resp ${minutes}m ${seconds}s`;
}

export default function responseTimerExtension(pi: ExtensionAPI) {
  let startedAt: number | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastContext:
    | {
      ui: {
        setStatus(key: string, text: string | undefined): void;
      };
    }
    | undefined;

  const clearIntervalIfRunning = () => {
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const updateStatus = () => {
    if (!lastContext || startedAt === undefined) return;
    lastContext.ui.setStatus(STATUS_KEY, formatElapsed(Date.now() - startedAt));
  };

  pi.on("session_start", async (_event, ctx) => {
    clearIntervalIfRunning();
    startedAt = undefined;
    lastContext = ctx;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("agent_start", async (_event, ctx) => {
    clearIntervalIfRunning();
    startedAt = Date.now();
    lastContext = ctx;
    updateStatus();
    interval = setInterval(updateStatus, UPDATE_INTERVAL_MS);
  });

  pi.on("agent_end", async (_event, ctx) => {
    lastContext = ctx;
    updateStatus();
    clearIntervalIfRunning();
  });
}
