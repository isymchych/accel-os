/**
 * Shows a live response timer in Pi's footer while the agent is working.
 *
 * It starts timing on `agent_start`, updates a footer status entry every 200ms, and leaves the final
 * elapsed time visible when the response completes until the next session start clears it.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "response-timer";
const UPDATE_INTERVAL_MS = 200;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;

type StatusContext = {
  ui: {
    setStatus(key: string, text: string | undefined): void;
  };
};

function formatElapsed(ms: number): string {
  if (ms < MINUTE_MS) {
    return `resp ${(ms / MS_PER_SECOND).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `resp ${minutes}m ${seconds}s`;
}

export default function responseTimerExtension(pi: ExtensionAPI): void {
  let startedAt: number | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastContext: StatusContext | undefined;

  const clearIntervalIfRunning = (): void => {
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const updateStatus = (): void => {
    if (lastContext === undefined || startedAt === undefined) {
      return;
    }
    lastContext.ui.setStatus(STATUS_KEY, formatElapsed(Date.now() - startedAt));
  };

  pi.on("session_start", (_event, ctx) => {
    clearIntervalIfRunning();
    startedAt = undefined;
    lastContext = ctx;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("agent_start", (_event, ctx) => {
    clearIntervalIfRunning();
    startedAt = Date.now();
    lastContext = ctx;
    updateStatus();
    interval = setInterval(updateStatus, UPDATE_INTERVAL_MS);
  });

  pi.on("agent_end", (_event, ctx) => {
    lastContext = ctx;
    updateStatus();
    clearIntervalIfRunning();
  });
}
