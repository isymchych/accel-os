/**
 * Consolidated OpenAI Codex integration for Pi.
 *
 * This extension keeps Codex-specific behavior under one ownership boundary:
 * native web search prompt/payload wiring, session-scoped verbosity control,
 * and the existing usage status overlay command.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import { isRecord } from "../../shared/guards.ts";
import {
  parseOpenAICodexCredential,
  resolveOpenAICodexRuntimeAccountProfile,
} from "./auth.ts";
import {
  type LimitWindow,
  type StatusSnapshot,
  renderStatusLines,
} from "./status.ts";
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
import {
  addCodexNativeWebSearchToPayload,
  OPENAI_CODEX_WEB_SEARCH_SECTION,
} from "./web-search.ts";

interface RawRateLimitWindowSnapshot {
  used_percent?: number | string | null;
  limit_window_seconds?: number | null;
  reset_after_seconds?: number | null;
  reset_at?: number | null;
}

interface RawRateLimitStatusDetails {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: RawRateLimitWindowSnapshot | null;
  secondary_window?: RawRateLimitWindowSnapshot | null;
}

interface RawRateLimitStatusPayload {
  plan_type?: string;
  rate_limit?: RawRateLimitStatusDetails | null;
}

interface CodexCredential {
  accessToken: string;
  accountId: string;
  email?: string;
  plan?: string;
}

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const MS_PER_SECOND = 1000;

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

function clampPercent(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeWindow(
  window: RawRateLimitWindowSnapshot | null | undefined,
): LimitWindow | undefined {
  if (!window) {
    return undefined;
  }

  const resetAtSeconds = typeof window.reset_at === "number" ? window.reset_at : undefined;
  const resetAfterSeconds =
    typeof window.reset_after_seconds === "number" ? window.reset_after_seconds : undefined;

  const normalized: LimitWindow = {
    usedPercent: clampPercent(window.used_percent),
  };

  if (typeof resetAtSeconds === "number") {
    normalized.resetsAt = resetAtSeconds * MS_PER_SECOND;
  } else if (typeof resetAfterSeconds === "number") {
    normalized.resetsAt = Date.now() + resetAfterSeconds * MS_PER_SECOND;
  }

  if (typeof window.limit_window_seconds === "number") {
    normalized.windowSeconds = window.limit_window_seconds;
  }

  return normalized;
}

function normalizePayload(payload: RawRateLimitStatusPayload): StatusSnapshot {
  const snapshot: StatusSnapshot = {
    fetchedAt: Date.now(),
  };

  if (typeof payload.plan_type === "string" && payload.plan_type.length > 0) {
    snapshot.planType = payload.plan_type;
  }
  if (typeof payload.rate_limit?.allowed === "boolean") {
    snapshot.allowed = payload.rate_limit.allowed;
  }
  if (typeof payload.rate_limit?.limit_reached === "boolean") {
    snapshot.limitReached = payload.rate_limit.limit_reached;
  }

  const primary = normalizeWindow(payload.rate_limit?.primary_window);
  if (primary !== undefined) {
    snapshot.primary = primary;
  }

  const secondary = normalizeWindow(payload.rate_limit?.secondary_window);
  if (secondary !== undefined) {
    snapshot.secondary = secondary;
  }

  return snapshot;
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

  const response = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.accountId,
      "User-Agent": "pi-inline-status",
    },
    method: "GET",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details ? ` ${details.replace(/\s+/g, " ").trim()}` : "";
    throw new Error(
      `OpenAI usage request failed (${response.status} ${response.statusText}).${suffix}`,
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error("OpenAI usage response payload was not an object.");
  }

  const snapshot = normalizePayload(payload);
  if (credential.email !== undefined && credential.email.length > 0) {
    snapshot.accountEmail = credential.email;
  }
  if (credential.plan !== undefined && credential.plan.length > 0) {
    snapshot.accountPlan = credential.plan;
  }

  return snapshot;
}

class StatusOverlay {
  public readonly width = 84;
  public readonly focused = true;

  public constructor(
    private readonly theme: Theme,
    private readonly lines: readonly string[],
    private readonly done: () => void,
  ) {}

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
