/**
 * Handoff Summary Extension
 *
 * Replaces Pi's default `/tree` branch summary and regular compaction summary
 * with focused handoff summaries. Branch summaries receive bounded shared
 * context from the common ancestor; compaction summaries preserve iterative
 * update behavior by merging new conversation state with any previous summary.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  buildBranchSummaryRequest,
  buildCompactionSummaryRequest,
  completeSummary,
  formatBranchSummary,
  formatCompactionSummary,
  hasRequiredHeadings,
} from "./summary.ts";

function fallbackReason(error: string | undefined): string {
  return error === undefined ? "using default" : `${error}; using default`;
}

export default function handoffSummary(pi: ExtensionAPI): void {
  pi.on("session_before_tree", async (event, ctx) => {
    if (!event.preparation.userWantsSummary) {
      return undefined;
    }

    const selectedModel = ctx.model;
    if (selectedModel === undefined) {
      ctx.ui.notify("Handoff summary: no active model; using default tree summary", "warning");
      return undefined;
    }
    const model = ctx.modelRegistry.find(selectedModel.provider, selectedModel.id);
    if (model === undefined) {
      ctx.ui.notify(
        "Handoff summary: active model is unavailable; using default tree summary",
        "warning",
      );
      return undefined;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(
        `Handoff summary auth failed: ${auth.error}; using default tree summary`,
        "warning",
      );
      return undefined;
    }

    const prepared = buildBranchSummaryRequest({
      model,
      entriesToSummarize: event.preparation.entriesToSummarize,
      sharedBranchEntries: ctx.sessionManager.getBranch(
        event.preparation.commonAncestorId ?? undefined,
      ),
      commonAncestorId: event.preparation.commonAncestorId,
      customInstructions: event.preparation.customInstructions,
      replaceInstructions: event.preparation.replaceInstructions,
    });
    if (!prepared.ok) {
      if (prepared.fallbackSummary !== undefined) {
        return { summary: { summary: prepared.fallbackSummary } };
      }
      ctx.ui.notify(
        `Handoff summary preparation failed: ${fallbackReason(prepared.error)} tree summary`,
        "warning",
      );
      return undefined;
    }

    const completed = await completeSummary(
      model,
      auth,
      prepared.request.promptText,
      prepared.request.responseTokens,
      event.signal,
    );
    if (!completed.ok) {
      if (!completed.aborted) {
        ctx.ui.notify(
          `Handoff summary failed: ${completed.error}; using default tree summary`,
          "warning",
        );
      }
      return undefined;
    }
    if (
      prepared.request.validateHeadings &&
      !hasRequiredHeadings(completed.text, ["Goal", "Branch Recap", "Next Concrete Action"])
    ) {
      ctx.ui.notify(
        "Handoff summary produced an invalid tree summary; using default tree summary",
        "warning",
      );
      return undefined;
    }

    const { readFiles, modifiedFiles } = prepared.request;
    return {
      summary: {
        summary: formatBranchSummary(completed.text, readFiles, modifiedFiles),
        details: { readFiles, modifiedFiles },
      },
    };
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const selectedModel = ctx.model;
    if (selectedModel === undefined) {
      ctx.ui.notify("Handoff summary: no active model; using default compaction", "warning");
      return undefined;
    }
    const model = ctx.modelRegistry.find(selectedModel.provider, selectedModel.id);
    if (model === undefined) {
      ctx.ui.notify(
        "Handoff summary: active model is unavailable; using default compaction",
        "warning",
      );
      return undefined;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(
        `Handoff summary auth failed: ${auth.error}; using default compaction`,
        "warning",
      );
      return undefined;
    }

    const prepared = buildCompactionSummaryRequest({
      model,
      messagesToSummarize: event.preparation.messagesToSummarize,
      isSplitTurn: event.preparation.isSplitTurn,
      turnPrefixMessages: event.preparation.turnPrefixMessages,
      previousSummary: event.preparation.previousSummary,
      customInstructions: event.customInstructions,
      fileOps: event.preparation.fileOps,
    });
    if (!prepared.ok) {
      if (prepared.error !== undefined) {
        ctx.ui.notify(
          `Handoff summary preparation failed: ${fallbackReason(prepared.error)} compaction`,
          "warning",
        );
      }
      return undefined;
    }

    const completed = await completeSummary(
      model,
      auth,
      prepared.request.promptText,
      prepared.request.responseTokens,
      event.signal,
    );
    if (!completed.ok) {
      if (!completed.aborted) {
        ctx.ui.notify(
          `Handoff summary failed: ${completed.error}; using default compaction`,
          "warning",
        );
      }
      return undefined;
    }
    if (
      !hasRequiredHeadings(completed.text, [
        "Goal",
        "Current State / Recap",
        "Next Concrete Action",
      ])
    ) {
      ctx.ui.notify(
        "Handoff summary produced an invalid compaction summary; using default compaction",
        "warning",
      );
      return undefined;
    }

    const { readFiles, modifiedFiles } = prepared.request;
    return {
      compaction: {
        summary: formatCompactionSummary(completed.text, readFiles, modifiedFiles),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: { readFiles, modifiedFiles },
      },
    };
  });
}
