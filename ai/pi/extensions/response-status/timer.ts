const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;
const ESTIMATED_CHARS_PER_TOKEN = 4;

export const WORKING_TIMER_PREFIX = "⏱ ";

export interface PromptCacheUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

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

function formatCompactTokens(tokens: number): string {
  if (tokens >= 10_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }

  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }

  return `${tokens}`;
}

function formatPromptCacheHitRate(cacheUsage: PromptCacheUsage): string | undefined {
  const totalPromptTokens =
    cacheUsage.inputTokens + cacheUsage.cacheReadTokens + cacheUsage.cacheWriteTokens;
  if (totalPromptTokens <= 0) {
    return undefined;
  }

  return `${((cacheUsage.cacheReadTokens / totalPromptTokens) * 100).toFixed(1)}%`;
}

function getPromptCacheSummaryParts(
  cacheUsage: PromptCacheUsage | undefined,
  includeRawTokens: boolean,
): string[] {
  if (cacheUsage === undefined) {
    return [];
  }

  const parts: string[] = [];
  const hitRate = formatPromptCacheHitRate(cacheUsage);
  if (hitRate !== undefined) {
    parts.push(`turn cache ${hitRate}`);
  }

  if (includeRawTokens && cacheUsage.cacheReadTokens > 0) {
    parts.push(`R${formatCompactTokens(cacheUsage.cacheReadTokens)}`);
  }
  if (includeRawTokens && cacheUsage.cacheWriteTokens > 0) {
    parts.push(`W${formatCompactTokens(cacheUsage.cacheWriteTokens)}`);
  }

  return parts;
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
  cacheUsage?: PromptCacheUsage,
): string {
  const summaryParts = [`${WORKING_TIMER_PREFIX}${formatElapsed(elapsedMs)}`];

  if (tps !== undefined) {
    const tokensPerSecond = formatTokensPerSecond(tps.outputTokens, tps.streamElapsedMs);
    if (tokensPerSecond !== undefined) {
      const prefix = tps.estimated ? "~" : "";
      summaryParts.push(`${prefix}${tokensPerSecond} tok/s`);
    }
  }

  summaryParts.push(...getPromptCacheSummaryParts(cacheUsage, false));
  return summaryParts.join(" · ");
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
  cacheUsage?: PromptCacheUsage,
): string {
  const summaryParts = [createTotalElapsedSummary(elapsedMs)];

  if (tps !== undefined) {
    const tokensPerSecond = formatTokensPerSecond(tps.outputTokens, tps.streamElapsedMs);
    if (tokensPerSecond !== undefined) {
      summaryParts.push(`${tokensPerSecond} tok/s`);
      summaryParts.push(`${tps.outputTokens} tokens`);
    }
  }

  summaryParts.push(...getPromptCacheSummaryParts(cacheUsage, true));
  return summaryParts.join(" · ");
}
