/**
 * Context Inspector Extension
 *
 * Adds `/context` so you can inspect the current Pi context budget, the active
 * path contribution, the effective system prompt snapshot, and the main loaded
 * resources that shape the next turn.
 */

import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
  SessionMessageEntry,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { buildSessionContext, DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";

import { buildContextReport, type CacheTurnInput, renderContextReport } from "./report.ts";

type ContextMode = "summary" | "prompt";

type TurnContextSnapshot = {
  assistantEntryId: string;
  systemPrompt: string;
  systemPromptOptions: BuildSystemPromptOptions;
  allTools: ToolInfo[];
  activeToolNames: string[];
};

function parseMode(rawArgs: string): ContextMode | null {
  const mode = rawArgs.trim();
  if (mode.length === 0 || mode === "summary") {
    return "summary";
  }
  if (mode === "prompt") {
    return mode;
  }
  return null;
}

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === "message";
}

function isAssistantMessage(
  message: SessionMessageEntry["message"],
): message is Extract<SessionMessageEntry["message"], { role: "assistant" }> {
  return message.role === "assistant";
}

function collectCacheTurns(
  entries: readonly SessionEntry[],
  activeBranchEntryIds: ReadonlySet<string>,
): CacheTurnInput[] {
  const turns: CacheTurnInput[] = [];
  let sequence = 0;

  for (const entry of entries) {
    if (!isMessageEntry(entry) || !isAssistantMessage(entry.message)) {
      continue;
    }

    sequence += 1;
    turns.push({
      sequence,
      isOnActiveBranch: activeBranchEntryIds.has(entry.id),
      timestamp: entry.timestamp,
      provider: entry.message.provider,
      model: entry.message.model,
      input: entry.message.usage.input,
      output: entry.message.usage.output,
      cacheRead: entry.message.usage.cacheRead,
      cacheWrite: entry.message.usage.cacheWrite,
      totalTokens: entry.message.usage.totalTokens,
    });
  }

  return turns;
}

function latestAssistantEntryId(entries: readonly SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && isMessageEntry(entry) && isAssistantMessage(entry.message)) {
      return entry.id;
    }
  }
  return undefined;
}

async function showSummary(reportText: string, ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    return;
  }

  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    const border = new DynamicBorder((s: string) => theme.fg("accent", s));
    container.addChild(border);
    container.addChild(new Text(reportText, 1, 0));
    container.addChild(
      new Text(theme.fg("dim", "Enter/Esc close · /context prompt for the prompt"), 1, 0),
    );
    container.addChild(border);

    return {
      render: (width: number): string[] => container.render(width),
      invalidate: (): void => container.invalidate(),
      handleInput: (data: string): void => {
        if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
          done(undefined);
        }
      },
    };
  });
}

export default function contextExtension(pi: ExtensionAPI): void {
  let pendingPromptOptions: BuildSystemPromptOptions | undefined;
  let pendingSnapshot: Omit<TurnContextSnapshot, "assistantEntryId"> | undefined;
  let lastTurnSnapshot: TurnContextSnapshot | undefined;

  pi.on("session_start", () => {
    pendingPromptOptions = undefined;
    pendingSnapshot = undefined;
    lastTurnSnapshot = undefined;
  });

  pi.on("session_tree", () => {
    lastTurnSnapshot = undefined;
  });

  pi.on("before_agent_start", (event) => {
    pendingPromptOptions = event.systemPromptOptions;
  });

  pi.on("agent_start", (_event, ctx) => {
    if (pendingPromptOptions === undefined) {
      return;
    }

    pendingSnapshot = {
      systemPrompt: ctx.getSystemPrompt(),
      systemPromptOptions: structuredClone(pendingPromptOptions),
      allTools: structuredClone(pi.getAllTools()),
      activeToolNames: [...pi.getActiveTools()],
    };
    pendingPromptOptions = undefined;
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (pendingSnapshot === undefined) {
      return;
    }

    const assistantEntryId = latestAssistantEntryId(ctx.sessionManager.getBranch());
    lastTurnSnapshot =
      assistantEntryId === undefined ? undefined : { ...pendingSnapshot, assistantEntryId };
    pendingSnapshot = undefined;
  });

  pi.registerCommand("context", {
    description: "Inspect current context usage and prompt resources (summary | prompt)",
    handler: async (args, ctx) => {
      const mode = parseMode(args);
      if (mode === null) {
        ctx.ui.notify("Usage: /context [summary|prompt]", "warning");
        return;
      }

      await ctx.waitForIdle();

      const allEntries = ctx.sessionManager.getEntries();
      const branchEntries = ctx.sessionManager.getBranch();
      const activeBranchEntryIds = new Set(branchEntries.map((entry) => entry.id));
      const messages = buildSessionContext(allEntries, ctx.sessionManager.getLeafId()).messages;
      const latestCompactionEntry = [...branchEntries]
        .reverse()
        .find((entry) => entry.type === "compaction");
      const latestAssistantId = latestAssistantEntryId(branchEntries);
      const promptSnapshot =
        lastTurnSnapshot?.assistantEntryId === latestAssistantId ? lastTurnSnapshot : undefined;
      const promptOptions = promptSnapshot?.systemPromptOptions ?? ctx.getSystemPromptOptions();
      const report = buildContextReport({
        systemPrompt: promptSnapshot?.systemPrompt ?? ctx.getSystemPrompt(),
        promptSource: promptSnapshot === undefined ? "current" : "last-turn",
        contextUsage: promptSnapshot === undefined ? undefined : ctx.getContextUsage(),
        messages,
        cacheTurns: collectCacheTurns(allEntries, activeBranchEntryIds),
        allTools: promptSnapshot?.allTools ?? pi.getAllTools(),
        activeToolNames: promptSnapshot?.activeToolNames ?? pi.getActiveTools(),
        contextFiles: promptOptions.contextFiles ?? [],
        session: {
          branchEntryCount: branchEntries.length,
          messageCount: messages.length,
          latestCompactionTokensBefore:
            latestCompactionEntry?.type === "compaction"
              ? latestCompactionEntry.tokensBefore
              : undefined,
        },
      });

      if (mode === "prompt") {
        await ctx.ui.editor("Context system prompt", report.systemPrompt);
        return;
      }

      await showSummary(renderContextReport(report), ctx);
    },
  });
}
