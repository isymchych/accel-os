/**
 * Controls OpenAI Codex response verbosity inside Pi.
 *
 * The extension applies per-model default verbosity levels copied from upstream Codex,
 * lets the user override that behavior for the current session branch via
 * `/verbosity low|medium|high|default`, persists the override in session metadata,
 * and injects the effective value into OpenAI Responses payloads for the
 * `openai-codex` provider only.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  type PersistedVerbosityState,
  type VerbosityLevel,
  applyVerbosityToOpenAIResponsesPayload,
  getVerbositySelections,
  isVerbositySelection,
  OPENAI_CODEX_VERBOSITY_ENTRY_TYPE,
  readPersistedVerbosityState,
  resolveOpenAICodexVerbosity,
} from "../lib/openai-codex-verbosity.ts";

function restoreSessionOverride(ctx: ExtensionContext): VerbosityLevel | undefined {
  let restored: VerbosityLevel | undefined;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== OPENAI_CODEX_VERBOSITY_ENTRY_TYPE) {
      continue;
    }

    const level = readPersistedVerbosityState(entry.data);
    if (level === null) {
      restored = undefined;
      continue;
    }
    if (level !== undefined) {
      restored = level;
    }
  }

  return restored;
}

function describeEffectiveVerbosity(
  ctx: ExtensionContext,
  sessionOverride: VerbosityLevel | undefined,
): string {
  const model = ctx.model;
  if (model?.provider !== "openai-codex") {
    return sessionOverride === undefined
      ? "No session override. OpenAI Codex model defaults will apply when you switch to that provider."
      : `Session override: ${sessionOverride}. It will apply when you use an OpenAI Codex model.`;
  }

  const effective = resolveOpenAICodexVerbosity(model.id, sessionOverride);
  const overrideText =
    sessionOverride === undefined ? "none" : `${sessionOverride} (session override)`;
  const effectiveText = effective ?? "unset";
  return `Current model: ${model.id}. Session override: ${overrideText}. Effective verbosity: ${effectiveText}.`;
}

export default function openAICodexVerbosityExtension(pi: ExtensionAPI): void {
  let sessionOverride: VerbosityLevel | undefined;

  const syncFromBranch = (ctx: ExtensionContext): void => {
    sessionOverride = restoreSessionOverride(ctx);
  };

  pi.on("session_start", async (_event, ctx) => {
    syncFromBranch(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    syncFromBranch(ctx);
  });

  pi.registerCommand("verbosity", {
    description: "Set OpenAI Codex response verbosity for this session branch",
    getArgumentCompletions: (prefix) => {
      const normalizedPrefix = prefix.trim().toLowerCase();
      const matches = getVerbositySelections().filter((value) =>
        value.startsWith(normalizedPrefix),
      );
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const selection = args.trim().toLowerCase();

      if (selection.length === 0) {
        ctx.ui.notify(describeEffectiveVerbosity(ctx, sessionOverride), "info");
        return;
      }

      if (!isVerbositySelection(selection)) {
        ctx.ui.notify("Usage: /verbosity low|medium|high|default", "error");
        return;
      }

      if (selection === "default") {
        sessionOverride = undefined;
        pi.appendEntry<PersistedVerbosityState>(OPENAI_CODEX_VERBOSITY_ENTRY_TYPE, {
          level: null,
        });
        ctx.ui.notify(
          `OpenAI Codex verbosity reset to model default. ${describeEffectiveVerbosity(ctx, sessionOverride)}`,
          "info",
        );
        return;
      }

      sessionOverride = selection;
      pi.appendEntry<PersistedVerbosityState>(OPENAI_CODEX_VERBOSITY_ENTRY_TYPE, {
        level: sessionOverride,
      });
      ctx.ui.notify(
        `OpenAI Codex verbosity set to ${sessionOverride}. ${describeEffectiveVerbosity(ctx, sessionOverride)}`,
        "info",
      );
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (model?.provider !== "openai-codex") {
      return undefined;
    }

    const verbosity = resolveOpenAICodexVerbosity(model.id, sessionOverride);
    if (verbosity === undefined) {
      return undefined;
    }

    return applyVerbosityToOpenAIResponsesPayload(event.payload, verbosity);
  });
}
