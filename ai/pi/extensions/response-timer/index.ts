/**
 * Owns Pi's streaming working row: a compact animated Nyan Cat plus a live
 * response timer and TPS estimate, then shows a final toast summary.
 *
 * Legacy appended timer markers are stripped from future LLM context so they
 * stay UI-only.
 */
import { homedir } from "node:os";

import type {
  ExtensionAPI,
  ExtensionContext,
  WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";

import {
  createCompletedTimerSummary,
  createWorkingTimerMessage,
  estimateTokensFromTextDelta,
  stripResponseTimerFromMessage,
} from "./timer.ts";

const UPDATE_INTERVAL_MS = 200;
const TITLE_PREFIX = "π   ";
const RESET_FG = "\x1b[39m";
const FRAME_INTERVAL_MS = 90;
const MAX_SHIFT = 4;
const TRAIL_WIDTH = 16;
const SHIFT_STEPS = [0, 1, 2, 3, 4, 3, 2, 1] as const;
const FACE_FRAMES = ["=^.^=", "=^-^="] as const;
const PASTRY_PATTERNS = ["::::", ".::.", ":..:"] as const;
const RAINBOW_COLORS = [
  "\x1b[38;2;255;0;0m",
  "\x1b[38;2;255;153;0m",
  "\x1b[38;2;255;255;0m",
  "\x1b[38;2;51;204;51m",
  "\x1b[38;2;51;153;255m",
  "\x1b[38;2;153;102;255m",
] as const;
const PASTRY_CRUST = "\x1b[38;2;194;140;92m";
const PASTRY_FILL = "\x1b[38;2;255;182;193m";
const CAT_FUR = "\x1b[38;2;170;170;170m";

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET_FG}`;
}

function createRainbowTrail(offset: number): string {
  let trail = "";
  for (let index = 0; index < TRAIL_WIDTH; index += 1) {
    const colorIndex = (index + offset) % RAINBOW_COLORS.length;
    const color = RAINBOW_COLORS[colorIndex] ?? RAINBOW_COLORS[0];
    trail += colorize("~", color);
  }
  return trail;
}

function createPastry(pattern: string): string {
  return `${colorize(",[", PASTRY_CRUST)}${colorize(pattern, PASTRY_FILL)}${colorize("],", PASTRY_CRUST)}`;
}

function createCatFrame(face: string, pastryPattern: string): string {
  return `${createPastry(pastryPattern)}${colorize(face, CAT_FUR)}`;
}

function createFrame(shift: number, rainbowOffset: number, catFrame: string): string {
  const leadingSpaces = " ".repeat(shift);
  const trailingSpaces = " ".repeat(MAX_SHIFT - shift);
  return `${leadingSpaces}${createRainbowTrail(rainbowOffset)}${catFrame}${trailingSpaces}`;
}

function createNyanWorkingIndicator(): WorkingIndicatorOptions {
  const catFrames = FACE_FRAMES.flatMap((face) =>
    PASTRY_PATTERNS.map((pastryPattern) => createCatFrame(face, pastryPattern)),
  );
  const frames = SHIFT_STEPS.flatMap((shift, step) =>
    catFrames.map((catFrame, catFrameIndex) => createFrame(shift, step + catFrameIndex, catFrame)),
  );

  return {
    frames,
    intervalMs: FRAME_INTERVAL_MS,
  };
}

function formatDisplayPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) {
    return "~";
  }
  if (cwd.startsWith(`${home}/`)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

async function getGitBranch(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
  const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    timeout: 5_000,
  });

  if (result.code !== 0) {
    return undefined;
  }

  const branch = result.stdout.trim();
  return branch.length > 0 ? branch : undefined;
}

async function getBaseTitle(pi: ExtensionAPI, cwd: string): Promise<string> {
  const displayPath = formatDisplayPath(cwd);
  const branch = await getGitBranch(pi, cwd);
  const location = branch !== undefined ? `${displayPath} (${branch})` : displayPath;
  return `${TITLE_PREFIX}  ${location}`;
}

const NYAN_WORKING_INDICATOR = createNyanWorkingIndicator();

export default function responseTimerExtension(pi: ExtensionAPI): void {
  let startedAt: number | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let baseTitle = TITLE_PREFIX;
  let assistantMessageStartedAt: number | undefined;
  let streamStartedAt: number | undefined;
  let estimatedStreamedTokens = 0;
  let liveOutputTokens = 0;
  let totalOutputTokens = 0;
  let totalStreamMs = 0;

  const resetAssistantStreamState = (): void => {
    assistantMessageStartedAt = undefined;
    streamStartedAt = undefined;
    estimatedStreamedTokens = 0;
    liveOutputTokens = 0;
  };

  const resetRunState = (): void => {
    startedAt = undefined;
    totalOutputTokens = 0;
    totalStreamMs = 0;
    resetAssistantStreamState();
  };

  const clearIntervalIfRunning = (): void => {
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const refreshBaseTitle = async (ctx: ExtensionContext): Promise<void> => {
    baseTitle = await getBaseTitle(pi, ctx.cwd);
  };

  const setIdleTitle = (ctx: ExtensionContext): void => {
    ctx.ui.setTitle(baseTitle);
  };

  const applyWorkingIndicator = (ctx: ExtensionContext): void => {
    ctx.ui.setWorkingIndicator(NYAN_WORKING_INDICATOR);
  };

  const clearWorkingTimer = (ctx: ExtensionContext): void => {
    ctx.ui.setWorkingMessage();
  };

  const updateWorkingTimer = (ctx: ExtensionContext): void => {
    if (startedAt === undefined) {
      return;
    }

    applyWorkingIndicator(ctx);
    const now = Date.now();
    const currentTokens = liveOutputTokens > 0 ? liveOutputTokens : estimatedStreamedTokens;
    const currentStreamStartedAt = streamStartedAt;
    const hasLiveTps = currentStreamStartedAt !== undefined && currentTokens > 0;

    ctx.ui.setWorkingMessage(
      createWorkingTimerMessage(
        now - startedAt,
        hasLiveTps
          ? {
              estimated: liveOutputTokens <= 0,
              outputTokens: currentTokens,
              streamElapsedMs: now - currentStreamStartedAt,
            }
          : undefined,
      ),
    );
  };

  pi.on("context", (event) => ({
    messages: event.messages.map((message) => stripResponseTimerFromMessage(message)),
  }));

  pi.on("session_start", async (_event, ctx) => {
    clearIntervalIfRunning();
    resetRunState();
    await refreshBaseTitle(ctx);
    setIdleTitle(ctx);
    applyWorkingIndicator(ctx);
    clearWorkingTimer(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    clearIntervalIfRunning();
    resetRunState();
    startedAt = Date.now();
    await refreshBaseTitle(ctx);
    setIdleTitle(ctx);
    updateWorkingTimer(ctx);
    interval = setInterval(() => {
      updateWorkingTimer(ctx);
    }, UPDATE_INTERVAL_MS);
  });

  pi.on("message_start", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }

    assistantMessageStartedAt = Date.now();
    streamStartedAt = undefined;
    estimatedStreamedTokens = 0;
    liveOutputTokens = 0;
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }

    const streamEvent = event.assistantMessageEvent;
    if (
      streamEvent.type !== "text_delta" &&
      streamEvent.type !== "thinking_delta" &&
      streamEvent.type !== "toolcall_delta"
    ) {
      return;
    }

    streamStartedAt ??= Date.now();
    estimatedStreamedTokens += estimateTokensFromTextDelta(streamEvent.delta);
    liveOutputTokens = Math.max(liveOutputTokens, event.message.usage.output);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      const messageOutputTokens = event.message.usage.output;
      const streamTimingStartedAt = streamStartedAt ?? assistantMessageStartedAt;
      if (messageOutputTokens > 0 && streamTimingStartedAt !== undefined) {
        totalOutputTokens += messageOutputTokens;
        totalStreamMs += Math.max(0, Date.now() - streamTimingStartedAt);
      }
      resetAssistantStreamState();
    }

    return undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const elapsedMs = startedAt === undefined ? undefined : Date.now() - startedAt;

    if (elapsedMs !== undefined) {
      const theme = ctx.ui.theme;
      const summary = createCompletedTimerSummary(
        elapsedMs,
        totalOutputTokens > 0 && totalStreamMs > 0
          ? {
              outputTokens: totalOutputTokens,
              streamElapsedMs: totalStreamMs,
            }
          : undefined,
      );
      ctx.ui.notify(`${theme.fg("success", "✓")} ${theme.fg("accent", summary)}`, "info");
    }

    resetRunState();
    clearIntervalIfRunning();
    await refreshBaseTitle(ctx);
    setIdleTitle(ctx);
    applyWorkingIndicator(ctx);
    clearWorkingTimer(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearIntervalIfRunning();
    resetRunState();
    setIdleTitle(ctx);
    clearWorkingTimer(ctx);
    ctx.ui.setWorkingIndicator();
  });
}
