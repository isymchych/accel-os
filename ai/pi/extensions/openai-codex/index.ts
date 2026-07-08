/**
 * Consolidated OpenAI Codex integration for Pi.
 *
 * This extension keeps Codex-specific behavior under one ownership boundary:
 * native web search prompt/payload wiring, session-scoped verbosity control,
 * and the existing usage status overlay command.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import { parseOpenAICodexCredential, resolveOpenAICodexRuntimeAccountProfile } from "./auth.ts";
import { type StatusSnapshot, renderStatusLines } from "./status.ts";
import { fetchUsageSnapshotForCredential } from "./usage.ts";
import {
  type PersistedVerbosityState,
  type VerbosityLevel,
  applyVerbosityToOpenAIResponsesPayload,
  getVerbositySelections,
  isVerbositySelection,
  OPENAI_CODEX_VERBOSITY_ENTRY_TYPE,
  readPersistedVerbosityState,
  resolveOpenAICodexVerbosity,
} from "./verbosity.ts";
import { addCodexNativeWebSearchToPayload, OPENAI_CODEX_WEB_SEARCH_SECTION } from "./web-search.ts";

interface CodexCredential {
  accessToken: string;
  accountId: string;
  email?: string;
  plan?: string;
}

const PROVIDER_ID = "openai-codex";

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
  if (model?.provider !== PROVIDER_ID) {
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

async function getCodexCredential(
  modelRegistry: ExtensionContext["modelRegistry"],
): Promise<CodexCredential | null> {
  const accessToken = await modelRegistry.getApiKeyForProvider(PROVIDER_ID);
  if (accessToken === undefined || accessToken.length === 0) {
    return null;
  }

  const authStorage = modelRegistry.authStorage;
  authStorage.reload();
  const refreshedCredential = parseOpenAICodexCredential(authStorage.get(PROVIDER_ID));

  const profile = resolveOpenAICodexRuntimeAccountProfile(refreshedCredential, accessToken);
  const accountId = profile.accountId;
  if (accountId === undefined || accountId.length === 0) {
    throw new Error("OpenAI Codex credential is missing ChatGPT account id.");
  }

  const credential: CodexCredential = {
    accessToken,
    accountId,
  };
  if (profile.email !== undefined) {
    credential.email = profile.email;
  }
  if (profile.plan !== undefined) {
    credential.plan = profile.plan;
  }
  return credential;
}

async function fetchUsageSnapshot(
  modelRegistry: ExtensionContext["modelRegistry"],
): Promise<StatusSnapshot> {
  const credential = await getCodexCredential(modelRegistry);
  if (!credential) {
    throw new Error("Not logged into OpenAI Codex. Run /login and choose OpenAI Codex.");
  }

  return await fetchUsageSnapshotForCredential(credential);
}

class StatusOverlay {
  public readonly width = 84;
  public readonly focused = true;
  private readonly theme: Theme;
  private readonly lines: readonly string[];
  private readonly done: () => void;

  public constructor(theme: Theme, lines: readonly string[], done: () => void) {
    this.theme = theme;
    this.lines = lines;
    this.done = done;
  }

  public handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return") || data.toLowerCase() === "q") {
      this.done();
    }
  }

  public render(width: number): string[] {
    const outerWidth = Math.max(48, Math.min(this.width, width));
    const innerWidth = outerWidth - 2;
    const pad = (text: string): string =>
      text + " ".repeat(Math.max(0, innerWidth - visibleWidth(text)));
    const row = (text: string): string =>
      this.theme.fg("border", "│") + pad(text) + this.theme.fg("border", "│");

    return [
      this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
      ...this.lines.map((line) => row(line)),
      row(""),
      row(this.theme.fg("dim", "Enter/Esc/q to close")),
      this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  public invalidate(): void {
    void this.focused;
  }

  public dispose(): void {
    void this.focused;
  }
}

export default function openAICodexExtension(pi: ExtensionAPI): void {
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

  pi.registerCommand("status", {
    description: "Show OpenAI Codex usage in a closable overlay",
    handler: async (_args, ctx) => {
      try {
        const snapshot = await fetchUsageSnapshot(ctx.modelRegistry);
        const lines = renderStatusLines(snapshot);
        await ctx.ui.custom(
          (_tui, theme, _keybindings, done) =>
            new StatusOverlay(theme, lines, () => {
              done(undefined);
            }),
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              margin: 1,
              maxHeight: "70%",
              minWidth: 52,
              width: 84,
            },
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
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
    if (model?.provider !== PROVIDER_ID) {
      return undefined;
    }

    let payload = addCodexNativeWebSearchToPayload(event.payload);
    const verbosity = resolveOpenAICodexVerbosity(model.id, sessionOverride);
    if (verbosity !== undefined) {
      const nextPayload = applyVerbosityToOpenAIResponsesPayload(payload, verbosity);
      if (nextPayload !== undefined) {
        payload = nextPayload;
      }
    }

    return payload;
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n${OPENAI_CODEX_WEB_SEARCH_SECTION}`,
    };
  });
}
