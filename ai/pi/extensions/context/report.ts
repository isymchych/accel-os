/**
 * Context report helpers for the `/context` Pi command.
 *
 * Owns the pure estimation and formatting logic so the extension stays thin
 * while tests cover the bucket math and text layout.
 */

import type {
  BuildSystemPromptOptions,
  ContextUsage,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolCallBlock {
  type: "toolCall";
  name: string;
  arguments: unknown;
}

type UserContentBlock = TextBlock | ImageBlock;
type AssistantContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;
type ToolResultContentBlock = TextBlock | ImageBlock;

export interface UserContextMessage {
  role: "user";
  content: string | readonly UserContentBlock[];
}

export interface AssistantContextMessage {
  role: "assistant";
  content: readonly AssistantContentBlock[];
}

export interface ToolResultContextMessage {
  role: "toolResult";
  toolName: string;
  content: string | readonly ToolResultContentBlock[];
}

export interface BashExecutionContextMessage {
  role: "bashExecution";
  command: string;
  output: string;
}

export interface CustomContextMessage {
  role: "custom";
  customType: string;
  content: string | readonly ToolResultContentBlock[];
}

export interface BranchSummaryContextMessage {
  role: "branchSummary";
  summary: string;
}

export interface CompactionSummaryContextMessage {
  role: "compactionSummary";
  summary: string;
}

export type ContextMessage =
  | UserContextMessage
  | AssistantContextMessage
  | ToolResultContextMessage
  | BashExecutionContextMessage
  | CustomContextMessage
  | BranchSummaryContextMessage
  | CompactionSummaryContextMessage;

export interface CacheTurnInput {
  sequence: number;
  isOnActiveBranch: boolean;
  timestamp: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface SessionInfoSnapshot {
  branchEntryCount: number;
  messageCount: number;
  latestCompactionTokensBefore: number | undefined;
}

export interface ContextReportInput {
  systemPrompt: string;
  promptSource: "last-turn" | "current";
  contextUsage: ContextUsage | undefined;
  messages: readonly ContextMessage[];
  cacheTurns: readonly CacheTurnInput[];
  allTools: readonly ToolInfo[];
  activeToolNames: readonly string[];
  contextFiles: NonNullable<BuildSystemPromptOptions["contextFiles"]>;
  session: SessionInfoSnapshot;
}

export interface BucketSnapshot {
  label: string;
  tokens: number;
  percentOfWindow: number | undefined;
  depth: 0 | 1;
}

export interface ResourceItem {
  name: string;
  path: string | undefined;
  description: string | undefined;
  tokens: number;
  percentOfWindow: number | undefined;
}

export interface CacheTurnSnapshot {
  sequence: number;
  isOnActiveBranch: boolean;
  timestamp: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  totalTokens: number;
  cacheHitPercent: number;
}

export interface CacheTotalsSnapshot {
  assistantMessages: number;
  input: number;
  output: number;
  cacheRead: number;
  totalTokens: number;
  cacheHitPercent: number;
}

export interface CacheSummarySnapshot {
  activeBranch: CacheTotalsSnapshot;
  wholeTree: CacheTotalsSnapshot;
  turns: CacheTurnSnapshot[];
  latestHitPercent: number | undefined;
  minHitPercent: number | undefined;
  maxHitPercent: number | undefined;
}

export interface ContextReport {
  usedTokens: number;
  usedTokensExact: boolean;
  contextWindow: number | undefined;
  availableTokens: number | undefined;
  usagePercent: number | undefined;
  systemPrompt: string;
  promptSource: "last-turn" | "current";
  buckets: BucketSnapshot[];
  contextFiles: ResourceItem[];
  activeTools: ResourceItem[];
  cache: CacheSummarySnapshot;
  session: SessionInfoSnapshot;
  notes: string[];
}

interface RawBucket {
  label: string;
  tokens: number;
  depth: 0 | 1;
}

interface RawMessageBreakdown {
  userTokens: number;
  assistantTextTokens: number;
  assistantThinkingTokens: number;
  assistantToolCallTokens: number;
  assistantToolCallCount: number;
  toolResultTokens: number;
  toolResultCount: number;
  bashTokens: number;
  customTokens: number;
  branchSummaryTokens: number;
  compactionSummaryTokens: number;
}

interface RawTokenItem {
  name: string;
  path: string | undefined;
  description: string | undefined;
  tokens: number;
}

const RECENT_CACHE_TURN_COUNT = 6;

function estimatePlainTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateTextAndImageBlocks(content: string | readonly ToolResultContentBlock[]): number {
  if (typeof content === "string") {
    return estimatePlainTextTokens(content);
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === "text") {
      chars += block.text.length;
      continue;
    }
    chars += 4_800;
  }

  return Math.ceil(chars / 4);
}

function estimateUserTokens(content: string | readonly UserContentBlock[]): number {
  if (typeof content === "string") {
    return estimatePlainTextTokens(content);
  }

  let chars = 0;
  for (const block of content) {
    if (block.type === "text") {
      chars += block.text.length;
    }
  }

  return Math.ceil(chars / 4);
}

function estimateMessageBreakdown(messages: readonly ContextMessage[]): RawMessageBreakdown {
  const breakdown: RawMessageBreakdown = {
    userTokens: 0,
    assistantTextTokens: 0,
    assistantThinkingTokens: 0,
    assistantToolCallTokens: 0,
    assistantToolCallCount: 0,
    toolResultTokens: 0,
    toolResultCount: 0,
    bashTokens: 0,
    customTokens: 0,
    branchSummaryTokens: 0,
    compactionSummaryTokens: 0,
  };

  for (const message of messages) {
    switch (message.role) {
      case "user": {
        breakdown.userTokens += estimateUserTokens(message.content);
        break;
      }
      case "assistant": {
        for (const block of message.content) {
          switch (block.type) {
            case "text":
              breakdown.assistantTextTokens += estimatePlainTextTokens(block.text);
              break;
            case "thinking":
              breakdown.assistantThinkingTokens += estimatePlainTextTokens(block.thinking);
              break;
            case "toolCall":
              breakdown.assistantToolCallTokens += estimatePlainTextTokens(
                block.name + JSON.stringify(block.arguments),
              );
              breakdown.assistantToolCallCount += 1;
              break;
            default:
              break;
          }
        }
        break;
      }
      case "toolResult":
        breakdown.toolResultTokens += estimateTextAndImageBlocks(message.content);
        breakdown.toolResultCount += 1;
        break;
      case "bashExecution":
        breakdown.bashTokens += estimatePlainTextTokens(message.command + message.output);
        break;
      case "custom":
        breakdown.customTokens += estimateTextAndImageBlocks(message.content);
        break;
      case "branchSummary":
        breakdown.branchSummaryTokens += estimatePlainTextTokens(message.summary);
        break;
      case "compactionSummary":
        breakdown.compactionSummaryTokens += estimatePlainTextTokens(message.summary);
        break;
      default:
        break;
    }
  }

  return breakdown;
}

function estimateToolDefinitionTokens(tool: ToolInfo): number {
  return estimatePlainTextTokens(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }),
  );
}

function normalizeBuckets(buckets: readonly RawBucket[], targetTotal: number): BucketSnapshot[] {
  const rawTotal = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
  if (rawTotal <= 0) {
    return buckets.map((bucket) => ({ ...bucket, tokens: 0, percentOfWindow: undefined }));
  }

  const scaled = buckets.map((bucket, index) => {
    const exactTokens = (bucket.tokens / rawTotal) * targetTotal;
    const whole = Math.floor(exactTokens);
    return {
      index,
      whole,
      fraction: exactTokens - whole,
    };
  });

  let remaining = targetTotal - scaled.reduce((sum, bucket) => sum + bucket.whole, 0);
  const byRemainder = [...scaled].sort((left, right) => {
    if (right.fraction !== left.fraction) {
      return right.fraction - left.fraction;
    }
    return left.index - right.index;
  });

  for (const bucket of byRemainder) {
    if (remaining <= 0) {
      break;
    }
    bucket.whole += 1;
    remaining -= 1;
  }

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    depth: bucket.depth,
    tokens: scaled[index]?.whole ?? 0,
    percentOfWindow: undefined,
  }));
}

function compareResourceItems(left: ResourceItem, right: ResourceItem): number {
  if (right.tokens !== left.tokens) {
    return right.tokens - left.tokens;
  }

  const leftLabel = left.path ?? left.name;
  const rightLabel = right.path ?? right.name;
  return leftLabel.localeCompare(rightLabel);
}

function normalizeTokenItems(
  items: readonly RawTokenItem[],
  targetTotal: number,
  contextWindow: number | undefined,
): ResourceItem[] {
  const rawTotal = items.reduce((sum, item) => sum + item.tokens, 0);
  if (rawTotal <= 0) {
    return [...items]
      .map((item) => ({
        ...item,
        tokens: 0,
        percentOfWindow: undefined,
      }))
      .sort(compareResourceItems);
  }

  const scaled = items.map((item, index) => {
    const exactTokens = (item.tokens / rawTotal) * targetTotal;
    const whole = Math.floor(exactTokens);
    return {
      index,
      whole,
      fraction: exactTokens - whole,
    };
  });

  let remaining = targetTotal - scaled.reduce((sum, item) => sum + item.whole, 0);
  const byRemainder = [...scaled].sort((left, right) => {
    if (right.fraction !== left.fraction) {
      return right.fraction - left.fraction;
    }
    return left.index - right.index;
  });

  for (const item of byRemainder) {
    if (remaining <= 0) {
      break;
    }
    item.whole += 1;
    remaining -= 1;
  }

  return items
    .map((item, index) => ({
      name: item.name,
      path: item.path,
      description: item.description,
      tokens: scaled[index]?.whole ?? 0,
      percentOfWindow:
        contextWindow === undefined || contextWindow === 0
          ? undefined
          : ((scaled[index]?.whole ?? 0) / contextWindow) * 100,
    }))
    .sort(compareResourceItems);
}

function computePercentOfWindow(
  tokens: number,
  contextWindow: number | undefined,
): number | undefined {
  if (contextWindow === undefined || contextWindow === 0) {
    return undefined;
  }

  return (tokens / contextWindow) * 100;
}

function estimateContextFileItemsRaw(
  contextFiles: NonNullable<BuildSystemPromptOptions["contextFiles"]>,
): RawTokenItem[] {
  return contextFiles.map((file) => ({
    name: file.path,
    path: file.path,
    description: undefined,
    tokens: estimatePlainTextTokens(file.content),
  }));
}

function estimateActiveToolItemsRaw(
  allTools: readonly ToolInfo[],
  activeToolNames: readonly string[],
): RawTokenItem[] {
  return allTools
    .filter((tool) => activeToolNames.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      path: undefined,
      description: tool.description,
      tokens: estimateToolDefinitionTokens(tool),
    }));
}

function sumTokens(items: readonly { tokens: number }[]): number {
  return items.reduce((sum, item) => sum + item.tokens, 0);
}

function buildConversationTokensRaw(messageBreakdown: RawMessageBreakdown): number {
  return (
    messageBreakdown.userTokens +
    messageBreakdown.assistantTextTokens +
    messageBreakdown.assistantThinkingTokens +
    messageBreakdown.bashTokens +
    messageBreakdown.customTokens +
    messageBreakdown.branchSummaryTokens +
    messageBreakdown.compactionSummaryTokens
  );
}

function buildMajorBucketsRaw(input: {
  systemPromptBaseTokensRaw: number;
  contextFilesTokensRaw: number;
  toolTokensRaw: number;
  messageBreakdown: RawMessageBreakdown;
  conversationTokensRaw: number;
}): RawBucket[] {
  return [
    { label: "System prompt base", tokens: input.systemPromptBaseTokensRaw, depth: 0 },
    { label: "Context files", tokens: input.contextFilesTokensRaw, depth: 0 },
    { label: "Tool definitions", tokens: input.toolTokensRaw, depth: 0 },
    {
      label: "Assistant tool calls",
      tokens: input.messageBreakdown.assistantToolCallTokens,
      depth: 0,
    },
    { label: "Tool results", tokens: input.messageBreakdown.toolResultTokens, depth: 0 },
    { label: "Conversation", tokens: input.conversationTokensRaw, depth: 0 },
  ];
}

function buildNormalizedConversationBuckets(
  messageBreakdown: RawMessageBreakdown,
  conversationTotal: number,
): BucketSnapshot[] {
  return normalizeBuckets(
    [
      { label: "User", tokens: messageBreakdown.userTokens, depth: 1 },
      { label: "Assistant text", tokens: messageBreakdown.assistantTextTokens, depth: 1 },
      { label: "Assistant thinking", tokens: messageBreakdown.assistantThinkingTokens, depth: 1 },
      { label: "Bash history", tokens: messageBreakdown.bashTokens, depth: 1 },
      {
        label: "Custom + summaries",
        tokens:
          messageBreakdown.customTokens +
          messageBreakdown.branchSummaryTokens +
          messageBreakdown.compactionSummaryTokens,
        depth: 1,
      },
    ],
    conversationTotal,
  );
}

function buildBucketsWithPercents(
  majorBuckets: readonly BucketSnapshot[],
  conversationBuckets: readonly BucketSnapshot[],
  contextWindow: number | undefined,
): BucketSnapshot[] {
  const buckets: BucketSnapshot[] = [];

  for (const bucket of majorBuckets) {
    buckets.push({
      ...bucket,
      percentOfWindow: computePercentOfWindow(bucket.tokens, contextWindow),
    });

    if (bucket.label !== "Conversation") {
      continue;
    }

    for (const conversationBucket of conversationBuckets) {
      if (conversationBucket.tokens <= 0) {
        continue;
      }

      buckets.push({
        ...conversationBucket,
        percentOfWindow: computePercentOfWindow(conversationBucket.tokens, contextWindow),
      });
    }
  }

  return buckets;
}

function computeCacheHitPercent(input: number, cacheRead: number): number {
  const denominator = input + cacheRead;
  if (denominator <= 0) {
    return 0;
  }
  return (cacheRead / denominator) * 100;
}

function emptyCacheTotals(): CacheTotalsSnapshot {
  return {
    assistantMessages: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    totalTokens: 0,
    cacheHitPercent: 0,
  };
}

function addToCacheTotals(totals: CacheTotalsSnapshot, turn: CacheTurnSnapshot): void {
  totals.assistantMessages += 1;
  totals.input += turn.input;
  totals.output += turn.output;
  totals.cacheRead += turn.cacheRead;
  totals.totalTokens += turn.totalTokens;
  totals.cacheHitPercent = computeCacheHitPercent(totals.input, totals.cacheRead);
}

function buildCacheSummary(cacheTurns: readonly CacheTurnInput[]): CacheSummarySnapshot {
  const activeBranch = emptyCacheTotals();
  const wholeTree = emptyCacheTotals();
  const turns: CacheTurnSnapshot[] = [];

  let latestHitPercent: number | undefined;
  let minHitPercent: number | undefined;
  let maxHitPercent: number | undefined;

  for (const turn of cacheTurns) {
    const cacheHitPercent = computeCacheHitPercent(turn.input, turn.cacheRead);
    const snapshot: CacheTurnSnapshot = {
      sequence: turn.sequence,
      isOnActiveBranch: turn.isOnActiveBranch,
      timestamp: turn.timestamp,
      provider: turn.provider,
      model: turn.model,
      input: turn.input,
      output: turn.output,
      cacheRead: turn.cacheRead,
      totalTokens: turn.totalTokens,
      cacheHitPercent,
    };

    turns.push(snapshot);
    addToCacheTotals(wholeTree, snapshot);
    if (snapshot.isOnActiveBranch) {
      addToCacheTotals(activeBranch, snapshot);
    }

    latestHitPercent = snapshot.cacheHitPercent;
    minHitPercent =
      minHitPercent === undefined
        ? snapshot.cacheHitPercent
        : Math.min(minHitPercent, snapshot.cacheHitPercent);
    maxHitPercent =
      maxHitPercent === undefined
        ? snapshot.cacheHitPercent
        : Math.max(maxHitPercent, snapshot.cacheHitPercent);
  }

  return {
    activeBranch,
    wholeTree,
    turns,
    latestHitPercent,
    minHitPercent,
    maxHitPercent,
  };
}

function buildNotes(promptSource: "last-turn" | "current", usedTokensExact: boolean): string[] {
  const notes = [
    usedTokensExact
      ? "Total usage is exact; the breakdown uses Pi's chars/4 estimates normalized to the current total."
      : "Usage and breakdown are estimated because Pi has no exact post-compaction token count yet.",
    "Cache hit rate = cacheRead / (input + cacheRead).",
  ];

  if (promptSource === "current") {
    notes.push(
      "Prompt details come from current resources; per-turn extension prompt changes appear after the next agent run.",
    );
  }

  return notes;
}

function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercent(percent: number | undefined): string {
  return percent === undefined ? "?" : `${percent.toFixed(1)}%`;
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : `${" ".repeat(width - value.length)}${value}`;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function formatUsageHeadline(report: ContextReport): string {
  if (report.contextWindow === undefined || report.availableTokens === undefined) {
    return `Used ${formatInt(report.usedTokens)}`;
  }

  return `Used ${formatInt(report.usedTokens)} / ${formatInt(report.contextWindow)} (${formatPercent(report.usagePercent)}) · Free ${formatInt(report.availableTokens)}`;
}

function formatSnapshotLine(report: ContextReport): string {
  const parts = [
    `Snapshot: ${report.promptSource === "last-turn" ? "last turn" : "current resources"}`,
    `${formatInt(report.session.messageCount)} messages`,
    `${formatInt(report.session.branchEntryCount)} entries`,
  ];

  if (report.session.latestCompactionTokensBefore !== undefined) {
    parts.push(`latest compaction ${formatInt(report.session.latestCompactionTokensBefore)}`);
  }

  return parts.join(" · ");
}

function renderBucketSection(title: string, buckets: readonly BucketSnapshot[]): string[] {
  const lines = [title];
  if (buckets.length === 0) {
    lines.push("  (none)");
    return lines;
  }

  const labelWidth = Math.max(...buckets.map((bucket) => bucket.label.length));
  const tokenWidth = Math.max(...buckets.map((bucket) => formatInt(bucket.tokens).length));
  const percentWidth = Math.max(
    ...buckets.map((bucket) => formatPercent(bucket.percentOfWindow).length),
  );

  for (const bucket of buckets) {
    const label = bucket.depth === 0 ? bucket.label : `  ${bucket.label}`;
    lines.push(
      `  ${padRight(label, labelWidth + (bucket.depth === 0 ? 0 : 2))}  ${padLeft(formatInt(bucket.tokens), tokenWidth)}  ${padLeft(formatPercent(bucket.percentOfWindow), percentWidth)}`,
    );
  }

  return lines;
}

function renderResourceSection(title: string, items: readonly ResourceItem[]): string[] {
  const lines = [title];
  if (items.length === 0) {
    lines.push("  (none)");
    return lines;
  }

  const tokenWidth = Math.max(...items.map((item) => formatInt(item.tokens).length));
  const percentWidth = Math.max(...items.map((item) => formatPercent(item.percentOfWindow).length));

  for (const item of items) {
    const label = item.path ?? item.name;
    lines.push(
      `  ${padLeft(formatInt(item.tokens), tokenWidth)}  ${padLeft(formatPercent(item.percentOfWindow), percentWidth)}  ${label}`,
    );
  }

  return lines;
}

function formatCacheTotalsLine(label: string, totals: CacheTotalsSnapshot): string {
  return `${label}: ${formatInt(totals.assistantMessages)} turns · sent ${formatInt(totals.input)} · received ${formatInt(totals.output)} · cache hit ${formatInt(totals.cacheRead)} · hit rate ${formatPercent(totals.cacheHitPercent)}`;
}

function formatModelLabel(provider: string, model: string): string {
  if (provider.length === 0) {
    return model;
  }
  if (model.startsWith(`${provider}/`)) {
    return model;
  }
  return `${provider}/${model}`;
}

function renderCacheTurns(turns: readonly CacheTurnSnapshot[]): string[] {
  const lines = ["Per-turn cache stats"];
  if (turns.length === 0) {
    lines.push("  (no assistant messages with usage data yet)");
    return lines;
  }

  const recentTurns = turns.slice(-RECENT_CACHE_TURN_COUNT);
  const rows = recentTurns.map((turn) => ({
    sequence: String(turn.sequence),
    branch: turn.isOnActiveBranch ? "*" : "",
    hitPercent: formatPercent(turn.cacheHitPercent),
    input: formatInt(turn.input),
    cacheRead: formatInt(turn.cacheRead),
    output: formatInt(turn.output),
    model: formatModelLabel(turn.provider, turn.model),
  }));

  const sequenceWidth = Math.max(1, ...rows.map((row) => row.sequence.length));
  const hitPercentWidth = Math.max(4, ...rows.map((row) => row.hitPercent.length));
  const inputWidth = Math.max(4, ...rows.map((row) => row.input.length));
  const cacheReadWidth = Math.max(9, ...rows.map((row) => row.cacheRead.length));
  const outputWidth = Math.max(4, ...rows.map((row) => row.output.length));

  lines.push(
    `  ${padLeft("#", sequenceWidth)}  ${padRight("B", 1)}  ${padLeft("hit%", hitPercentWidth)}  ${padLeft("sent", inputWidth)}  ${padLeft("cache-hit", cacheReadWidth)}  ${padLeft("recv", outputWidth)}  model`,
  );

  for (const row of rows) {
    lines.push(
      `  ${padLeft(row.sequence, sequenceWidth)}  ${padRight(row.branch, 1)}  ${padLeft(row.hitPercent, hitPercentWidth)}  ${padLeft(row.input, inputWidth)}  ${padLeft(row.cacheRead, cacheReadWidth)}  ${padLeft(row.output, outputWidth)}  ${row.model}`,
    );
  }

  return lines;
}

export function buildContextReport(input: ContextReportInput): ContextReport {
  const promptTokensRaw = estimatePlainTextTokens(input.systemPrompt);
  const contextFileItemsRaw = estimateContextFileItemsRaw(input.contextFiles);
  const contextFilesTokensRaw = sumTokens(contextFileItemsRaw);
  const systemPromptBaseTokensRaw = Math.max(0, promptTokensRaw - contextFilesTokensRaw);

  const activeToolItemsRaw = estimateActiveToolItemsRaw(input.allTools, input.activeToolNames);
  const toolTokensRaw = sumTokens(activeToolItemsRaw);

  const messageBreakdown = estimateMessageBreakdown(input.messages);
  const conversationTokensRaw = buildConversationTokensRaw(messageBreakdown);
  const majorBucketsRaw = buildMajorBucketsRaw({
    systemPromptBaseTokensRaw,
    contextFilesTokensRaw,
    toolTokensRaw,
    messageBreakdown,
    conversationTokensRaw,
  });

  const rawUsedTokens = sumTokens(majorBucketsRaw);
  const exactUsedTokens = input.contextUsage?.tokens ?? null;
  const usedTokens = exactUsedTokens ?? rawUsedTokens;
  const contextWindow = input.contextUsage?.contextWindow;
  const usagePercent = computePercentOfWindow(usedTokens, contextWindow);

  const normalizedMajorBuckets = normalizeBuckets(majorBucketsRaw, usedTokens);
  const normalizedConversationBuckets = buildNormalizedConversationBuckets(
    messageBreakdown,
    normalizedMajorBuckets.find((bucket) => bucket.label === "Conversation")?.tokens ?? 0,
  );
  const buckets = buildBucketsWithPercents(
    normalizedMajorBuckets,
    normalizedConversationBuckets,
    contextWindow,
  );

  const availableTokens =
    contextWindow === undefined ? undefined : Math.max(0, contextWindow - usedTokens);

  const contextFiles = normalizeTokenItems(
    contextFileItemsRaw,
    normalizedMajorBuckets.find((bucket) => bucket.label === "Context files")?.tokens ?? 0,
    contextWindow,
  );
  const activeToolItems = normalizeTokenItems(
    activeToolItemsRaw,
    normalizedMajorBuckets.find((bucket) => bucket.label === "Tool definitions")?.tokens ?? 0,
    contextWindow,
  );

  return {
    usedTokens,
    usedTokensExact: exactUsedTokens !== null,
    contextWindow,
    availableTokens,
    usagePercent,
    systemPrompt: input.systemPrompt,
    promptSource: input.promptSource,
    buckets,
    contextFiles,
    activeTools: activeToolItems,
    cache: buildCacheSummary(input.cacheTurns),
    session: input.session,
    notes: buildNotes(input.promptSource, exactUsedTokens !== null),
  };
}

export function renderContextReport(report: ContextReport): string {
  const majorBuckets = report.buckets.filter((bucket) => bucket.depth === 0);
  const detailBuckets = report.buckets.filter((bucket) => bucket.depth === 1);
  const lines = [
    "Context",
    formatUsageHeadline(report),
    formatSnapshotLine(report),
    `Note: ${report.usedTokensExact ? "total exact, breakdown estimated" : "usage and breakdown estimated"}`,
    "",
    ...renderBucketSection("Current context breakdown", majorBuckets),
  ];

  if (detailBuckets.length > 0) {
    lines.push("", ...renderBucketSection("Conversation detail", detailBuckets));
  }

  lines.push(
    "",
    ...renderResourceSection(`Context files (${report.contextFiles.length})`, report.contextFiles),
    "",
    ...renderResourceSection(`Active tools (${report.activeTools.length})`, report.activeTools),
    "",
    "Cache summary",
    formatCacheTotalsLine("Active branch", report.cache.activeBranch),
    formatCacheTotalsLine("Whole tree", report.cache.wholeTree),
  );

  if (
    report.cache.latestHitPercent !== undefined &&
    report.cache.minHitPercent !== undefined &&
    report.cache.maxHitPercent !== undefined
  ) {
    lines.push(
      `Latest ${formatPercent(report.cache.latestHitPercent)} · Min ${formatPercent(report.cache.minHitPercent)} · Max ${formatPercent(report.cache.maxHitPercent)}`,
    );
  }

  lines.push("", ...renderCacheTurns(report.cache.turns), "", "Notes");
  for (const note of report.notes) {
    lines.push(`  - ${note}`);
  }

  return lines.join("\n");
}
