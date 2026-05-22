/**
 * Context Inspector Extension
 *
 * Adds `/context` so you can inspect the current Pi context budget, the active
 * path contribution, the effective system prompt snapshot, and the main loaded
 * resources that shape the next turn.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import {
  buildSessionContext,
  DynamicBorder,
  loadProjectContextFiles,
} from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";

import { buildContextReport, type CacheTurnInput, renderContextReport } from "./report.ts";

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type PromptSnapshot = {
  systemPrompt: string;
  systemPromptOptions: BuildSystemPromptOptions;
};

type ContextMode = "summary" | "prompt";

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

function listContextFiles(
  cwd: string,
  snapshot: PromptSnapshot | undefined,
): NonNullable<BuildSystemPromptOptions["contextFiles"]> {
  if (snapshot?.systemPromptOptions.contextFiles !== undefined) {
    return snapshot.systemPromptOptions.contextFiles;
  }

  return loadProjectContextFiles({ cwd, agentDir: AGENT_DIR });
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

async function showSummary(reportText: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
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
  let lastPromptSnapshot: PromptSnapshot | undefined;

  pi.on("session_start", async () => {
    lastPromptSnapshot = undefined;
  });

  pi.on("before_agent_start", async (event) => {
    lastPromptSnapshot = {
      systemPrompt: event.systemPrompt,
      systemPromptOptions: event.systemPromptOptions,
    };
    return undefined;
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (lastPromptSnapshot === undefined) {
      return;
    }

    lastPromptSnapshot = {
      ...lastPromptSnapshot,
      systemPrompt: ctx.getSystemPrompt(),
    };
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

      const promptSnapshot = lastPromptSnapshot;
      const allEntries = ctx.sessionManager.getEntries();
      const branchEntries = ctx.sessionManager.getBranch();
      const activeBranchEntryIds = new Set(branchEntries.map((entry) => entry.id));
      const contextMessages = buildSessionContext(
        allEntries,
        ctx.sessionManager.getLeafId(),
      ).messages;
      const latestCompactionEntry = [...branchEntries]
        .reverse()
        .find((entry) => entry.type === "compaction");
      const report = buildContextReport({
        systemPrompt: promptSnapshot?.systemPrompt ?? ctx.getSystemPrompt(),
        promptSource: promptSnapshot === undefined ? "current" : "last-turn",
        contextUsage: ctx.getContextUsage(),
        messages: contextMessages,
        cacheTurns: collectCacheTurns(allEntries, activeBranchEntryIds),
        allTools: pi.getAllTools(),
        activeToolNames: pi.getActiveTools(),
        contextFiles: listContextFiles(ctx.cwd, promptSnapshot),
        session: {
          branchEntryCount: branchEntries.length,
          messageCount: contextMessages.length,
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
