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
  activeTools: ResourceItem[];
  contextFiles: ResourceItem[];
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

function formatCompactTokens(tokens: number): string {
  if (tokens >= 100_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }
  if (tokens >= 10_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return thousands >= 10 ? `${Math.round(thousands)}k` : `${thousands.toFixed(1)}k`;
  }
  return `${tokens}`;
}

function formatPercent(percent: number | undefined): string {
  if (percent === undefined) {
    return "   ?";
  }
  return percent.toFixed(1).padStart(5, " ");
}

function formatTokenAndPercent(
  label: string,
  tokens: number,
  percent: number | undefined,
  width: number,
): string {
  const padded = label.padEnd(width, " ");
  return `${padded} ${formatCompactTokens(tokens).padStart(6, " ")} (${formatPercent(percent)}%)`;
}

function toResourceItems(
  items: readonly { name: string; path: string | undefined; description: string | undefined }[],
): ResourceItem[] {
  return items.map((item) => ({ ...item }));
}

function buildNotes(promptSource: "last-turn" | "current", usedTokensExact: boolean): string[] {
  const notes = [
    usedTokensExact
      ? "Bucket breakdown is estimated with Pi's chars/4 heuristic and normalized to Pi's current total usage."
      : "Usage is estimated because Pi has no exact post-compaction token count yet.",
  ];

  if (promptSource === "current") {
    notes.push(
      "Prompt details come from current resources; per-turn extension prompt changes appear after the next agent run.",
    );
  }

  return notes;
}

export function buildContextReport(input: ContextReportInput): ContextReport {
  const promptTokensRaw = estimatePlainTextTokens(input.systemPrompt);
  const activeTools = input.allTools.filter((tool) => input.activeToolNames.includes(tool.name));
  const toolTokensRaw = activeTools.reduce(
    (sum, tool) => sum + estimateToolDefinitionTokens(tool),
    0,
  );
  const messageBreakdown = estimateMessageBreakdown(input.messages);

  const conversationTokensRaw =
    messageBreakdown.userTokens +
    messageBreakdown.assistantTextTokens +
    messageBreakdown.assistantThinkingTokens +
    messageBreakdown.bashTokens +
    messageBreakdown.customTokens +
    messageBreakdown.branchSummaryTokens +
    messageBreakdown.compactionSummaryTokens;

  const majorBucketsRaw: RawBucket[] = [
    { label: "System Prompt", tokens: promptTokensRaw, depth: 0 },
    { label: "System Tools", tokens: toolTokensRaw, depth: 0 },
    { label: "Assistant Tool Calls", tokens: messageBreakdown.assistantToolCallTokens, depth: 0 },
    { label: "Tool Results", tokens: messageBreakdown.toolResultTokens, depth: 0 },
    { label: "Messages", tokens: conversationTokensRaw, depth: 0 },
  ];

  const rawUsedTokens = majorBucketsRaw.reduce((sum, bucket) => sum + bucket.tokens, 0);
  const exactUsedTokens = input.contextUsage?.tokens ?? null;
  const usedTokens = exactUsedTokens ?? rawUsedTokens;
  const contextWindow = input.contextUsage?.contextWindow;
  const usagePercent =
    contextWindow === undefined || contextWindow === 0
      ? undefined
      : (usedTokens / contextWindow) * 100;
  const normalizedMajorBuckets = normalizeBuckets(majorBucketsRaw, usedTokens);
  const normalizedMessages = normalizeBuckets(
    [
      { label: "User", tokens: messageBreakdown.userTokens, depth: 1 },
      { label: "Assistant Text", tokens: messageBreakdown.assistantTextTokens, depth: 1 },
      { label: "Assistant Thinking", tokens: messageBreakdown.assistantThinkingTokens, depth: 1 },
      { label: "Bash History", tokens: messageBreakdown.bashTokens, depth: 1 },
      {
        label: "Custom + Summaries",
        tokens:
          messageBreakdown.customTokens +
          messageBreakdown.branchSummaryTokens +
          messageBreakdown.compactionSummaryTokens,
        depth: 1,
      },
    ],
    normalizedMajorBuckets.find((bucket) => bucket.label === "Messages")?.tokens ?? 0,
  );

  const buckets: BucketSnapshot[] = [];
  for (const bucket of normalizedMajorBuckets) {
    const percentOfWindow =
      contextWindow === undefined || contextWindow === 0
        ? undefined
        : (bucket.tokens / contextWindow) * 100;
    buckets.push({ ...bucket, percentOfWindow });
    if (bucket.label === "Messages") {
      for (const messageBucket of normalizedMessages) {
        if (messageBucket.tokens <= 0) {
          continue;
        }
        const subPercent =
          contextWindow === undefined || contextWindow === 0
            ? undefined
            : (messageBucket.tokens / contextWindow) * 100;
        buckets.push({ ...messageBucket, percentOfWindow: subPercent });
      }
    }
  }

  const availableTokens =
    contextWindow === undefined ? undefined : Math.max(0, contextWindow - usedTokens);
  const contextFiles = toResourceItems(
    input.contextFiles.map((file) => ({
      name: file.path,
      path: file.path,
      description: undefined,
    })),
  );
  const activeToolItems = toResourceItems(
    activeTools.map((tool) => ({
      name: tool.name,
      path: undefined,
      description: tool.description,
    })),
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
    activeTools: activeToolItems,
    contextFiles,
    session: input.session,
    notes: buildNotes(input.promptSource, exactUsedTokens !== null),
  };
}

function summarizeItems(items: readonly ResourceItem[], maxItems: number): string[] {
  if (items.length === 0) {
    return ["  (none)"];
  }

  const visible = items.slice(0, maxItems).map((item) => {
    if (item.path !== undefined) {
      return `  - ${item.name} — ${item.path}`;
    }
    if (item.description !== undefined && item.description.length > 0) {
      return `  - ${item.name} — ${item.description}`;
    }
    return `  - ${item.name}`;
  });

  const hiddenCount = items.length - visible.length;
  if (hiddenCount > 0) {
    visible.push(`  - +${hiddenCount} more`);
  }

  return visible;
}

export function renderContextReport(report: ContextReport): string {
  const majorBuckets = report.buckets.filter((bucket) => bucket.depth === 0);
  const detailBuckets = report.buckets.filter((bucket) => bucket.depth === 1);
  const labelWidth = Math.max(
    "Available".length,
    ...majorBuckets.map((bucket) => bucket.label.length),
  );
  const detailLabelWidth = Math.max(1, ...detailBuckets.map((bucket) => bucket.label.length));
  const totalLabel = report.usedTokensExact ? "Total Usage" : "Estimated Usage";

  const lines = [
    formatTokenAndPercent(totalLabel, report.usedTokens, report.usagePercent, labelWidth),
    "",
    ...majorBuckets.map((bucket) =>
      formatTokenAndPercent(bucket.label, bucket.tokens, bucket.percentOfWindow, labelWidth),
    ),
  ];

  if (detailBuckets.length > 0) {
    lines.push(
      ...detailBuckets.map((bucket) =>
        formatTokenAndPercent(
          `  ${bucket.label}`,
          bucket.tokens,
          bucket.percentOfWindow,
          detailLabelWidth + 2,
        ),
      ),
    );
  }

  if (report.availableTokens !== undefined) {
    const availablePercent =
      report.contextWindow === undefined || report.contextWindow === 0
        ? undefined
        : (report.availableTokens / report.contextWindow) * 100;
    lines.push(
      formatTokenAndPercent("Available", report.availableTokens, availablePercent, labelWidth),
    );
  }

  lines.push(
    "",
    "Snapshot",
    `  Prompt source: ${report.promptSource === "last-turn" ? "last turn" : "current resources"}`,
    `  Active path: ${report.session.messageCount} messages, ${report.session.branchEntryCount} entries`,
  );

  if (report.session.latestCompactionTokensBefore !== undefined) {
    lines.push(
      `  Latest compaction: summarized ${formatCompactTokens(report.session.latestCompactionTokensBefore)}`,
    );
  }

  lines.push("", `Context files (${report.contextFiles.length})`);
  lines.push(...summarizeItems(report.contextFiles, 5));

  lines.push("", `Active tools (${report.activeTools.length})`);
  lines.push(...summarizeItems(report.activeTools, 8));

  lines.push("", "Notes");
  for (const note of report.notes) {
    lines.push(`  - ${note}`);
  }

  return lines.join("\n");
}
