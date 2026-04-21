/**
 * Adds a `/status` command that shows OpenAI Codex usage and rate-limit state in an overlay.
 *
 * It reads the saved Codex OAuth credentials from Pi auth storage, calls ChatGPT's usage endpoint,
 * normalizes the response into primary/secondary limit windows, and renders the remaining quota plus
 * reset timing in a dismissible centered modal.
 */
import { AuthStorage, type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";

import { isRecord } from "../lib/guards.ts";
import {
  parseOpenAICodexCredential,
  readOpenAICodexAccountProfile,
} from "../lib/openai-codex-auth.ts";
import {
  type LimitWindow,
  type StatusSnapshot,
  renderStatusLines,
} from "../lib/openai-codex-status.ts";

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

async function getCodexCredential(authStorage: AuthStorage): Promise<CodexCredential | null> {
  authStorage.reload();
  const currentCredential = parseOpenAICodexCredential(authStorage.get(PROVIDER_ID));
  if (currentCredential === null) {
    return null;
  }

  const accessToken = await authStorage.getApiKey(PROVIDER_ID);
  if (accessToken === undefined || accessToken.length === 0) {
    return null;
  }

  authStorage.reload();
  const refreshedCredential = parseOpenAICodexCredential(authStorage.get(PROVIDER_ID));
  if (refreshedCredential === null) {
    return null;
  }

  const profile = readOpenAICodexAccountProfile(accessToken);
  const accountId = refreshedCredential.accountId ?? profile.accountId;
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

async function fetchUsageSnapshot(authStorage: AuthStorage): Promise<StatusSnapshot> {
  const credential = await getCodexCredential(authStorage);
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

export default function openAICodexStatusExtension(pi: ExtensionAPI): void {
  const authStorage = AuthStorage.create();

  pi.registerCommand("status", {
    description: "Show OpenAI Codex usage in a closable overlay",
    handler: async (_args, ctx) => {
      try {
        const snapshot = await fetchUsageSnapshot(authStorage);
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
}
