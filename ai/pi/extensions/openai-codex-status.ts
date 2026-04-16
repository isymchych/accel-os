import { AuthStorage, type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";

type RawRateLimitWindowSnapshot = {
  used_percent?: number | string | null;
  limit_window_seconds?: number | null;
  reset_after_seconds?: number | null;
  reset_at?: number | null;
};

type RawRateLimitStatusDetails = {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: RawRateLimitWindowSnapshot | null;
  secondary_window?: RawRateLimitWindowSnapshot | null;
};

type RawRateLimitStatusPayload = {
  plan_type?: string;
  rate_limit?: RawRateLimitStatusDetails | null;
};

type LimitWindow = {
  usedPercent: number;
  windowSeconds?: number;
  resetsAt?: number;
};

type StatusSnapshot = {
  planType?: string;
  allowed?: boolean;
  limitReached?: boolean;
  primary?: LimitWindow;
  secondary?: LimitWindow;
  fetchedAt: number;
};

type OAuthCredentialShape = {
  type: "oauth";
  access?: string;
  expires?: number;
  accountId?: string;
};

type CodexCredential = {
  accessToken: string;
  accountId: string;
};

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function clampPercent(value: unknown): number {
  const n = typeof value === "string"
    ? Number(value)
    : typeof value === "number"
    ? value
    : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (payload.length % 4)) % 4;
    const base64 = payload + "=".repeat(padLength);
    const json = Buffer.from(base64, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getAccountIdFromToken(token: string): string | undefined {
  const payload = parseJwtPayload(token);
  if (!payload) return undefined;

  const direct = payload["https://api.openai.com/auth.chatgpt_account_id"];
  if (typeof direct === "string" && direct.length > 0) return direct;

  const auth = payload["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object") return undefined;

  const nested = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof nested === "string" && nested.length > 0 ? nested : undefined;
}

async function getCodexCredential(
  authStorage: AuthStorage,
): Promise<CodexCredential | null> {
  authStorage.reload();
  let cred = authStorage.get(PROVIDER_ID) as OAuthCredentialShape | undefined;
  if (!cred || cred.type !== "oauth") return null;

  if (typeof cred.expires === "number" && Date.now() >= cred.expires) {
    await authStorage.refreshOAuthTokenWithLock(PROVIDER_ID);
    authStorage.reload();
    cred = authStorage.get(PROVIDER_ID) as OAuthCredentialShape | undefined;
    if (!cred || cred.type !== "oauth") return null;
  }

  const accessToken = cred.access ?? await authStorage.getApiKey(PROVIDER_ID);
  if (!accessToken) return null;

  const accountId = cred.accountId ?? getAccountIdFromToken(accessToken);
  if (!accountId) {
    throw new Error("OpenAI Codex credential is missing ChatGPT account id.");
  }

  return { accessToken, accountId };
}

function normalizeWindow(
  window: RawRateLimitWindowSnapshot | null | undefined,
): LimitWindow | undefined {
  if (!window) return undefined;

  const resetAtSeconds = typeof window.reset_at === "number"
    ? window.reset_at
    : undefined;
  const resetAfterSeconds = typeof window.reset_after_seconds === "number"
    ? window.reset_after_seconds
    : undefined;

  return {
    usedPercent: clampPercent(window.used_percent),
    windowSeconds: typeof window.limit_window_seconds === "number"
      ? window.limit_window_seconds
      : undefined,
    resetsAt: typeof resetAtSeconds === "number"
      ? resetAtSeconds * 1000
      : typeof resetAfterSeconds === "number"
      ? Date.now() + resetAfterSeconds * 1000
      : undefined,
  };
}

function normalizePayload(payload: RawRateLimitStatusPayload): StatusSnapshot {
  return {
    planType: payload.plan_type,
    allowed: payload.rate_limit?.allowed,
    limitReached: payload.rate_limit?.limit_reached,
    primary: normalizeWindow(payload.rate_limit?.primary_window),
    secondary: normalizeWindow(payload.rate_limit?.secondary_window),
    fetchedAt: Date.now(),
  };
}

async function fetchUsageSnapshot(authStorage: AuthStorage): Promise<StatusSnapshot> {
  const credential = await getCodexCredential(authStorage);
  if (!credential) {
    throw new Error(
      "Not logged into OpenAI Codex. Run /login and choose OpenAI Codex.",
    );
  }

  const response = await fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.accountId,
      "User-Agent": "pi-inline-status",
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details ? ` ${details.replace(/\s+/g, " ").trim()}` : "";
    throw new Error(
      `OpenAI usage request failed (${response.status} ${response.statusText}).${suffix}`,
    );
  }

  const payload = await response.json() as RawRateLimitStatusPayload;
  return normalizePayload(payload);
}

function describeWindow(seconds?: number): string {
  if (!seconds || seconds <= 0) return "limit";
  const hours = seconds / 3600;
  const days = seconds / 86_400;
  if (hours <= 24) return `${Math.max(1, Math.round(hours))}h limit`;
  if (days <= 7.5) return "weekly limit";
  if (days <= 31) return "monthly limit";
  return "usage limit";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function formatReset(timestamp?: number): string {
  if (!timestamp) return "reset unknown";
  const diff = timestamp - Date.now();
  if (diff <= 0) return "resets now";
  return `resets in ${formatDuration(diff)}`;
}

function formatWindow(window: LimitWindow | undefined): string {
  if (!window) return "unavailable";
  const left = Math.max(0, 100 - window.usedPercent);
  return `${left}% left (${formatReset(window.resetsAt)})`;
}

function renderLines(snapshot: StatusSnapshot): string[] {
  const header = snapshot.planType
    ? `OpenAI Codex (${snapshot.planType})`
    : "OpenAI Codex";
  const statusBits: string[] = [];
  if (typeof snapshot.allowed === "boolean") {
    statusBits.push(snapshot.allowed ? "allowed" : "blocked");
  }
  if (snapshot.limitReached) statusBits.push("limit reached");

  const lines = [
    header,
    `${describeWindow(snapshot.primary?.windowSeconds)}: ${formatWindow(snapshot.primary)}`,
    `${describeWindow(snapshot.secondary?.windowSeconds)}: ${formatWindow(snapshot.secondary)}`,
  ];

  if (statusBits.length > 0) {
    lines.splice(1, 0, `Status: ${statusBits.join(" · ")}`);
  }

  return lines;
}

class StatusOverlay {
  readonly width = 76;
  focused = true;

  constructor(
    private theme: Theme,
    private lines: string[],
    private done: () => void,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "return") ||
      data.toLowerCase() === "q"
    ) {
      this.done();
    }
  }

  render(width: number): string[] {
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

  invalidate(): void {}
  dispose(): void {}
}

export default function openAICodexStatusExtension(pi: ExtensionAPI) {
  const authStorage = AuthStorage.create();

  pi.registerCommand("status", {
    description: "Show OpenAI Codex usage in a closable overlay",
    handler: async (_args, ctx) => {
      try {
        const snapshot = await fetchUsageSnapshot(authStorage);
        const lines = renderLines(snapshot);
        await ctx.ui.custom<void>(
          (_tui, theme, _keybindings, done) =>
            new StatusOverlay(theme, lines, done),
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              width: "72%",
              minWidth: 52,
              maxWidth: 84,
              maxHeight: "70%",
              margin: 1,
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
