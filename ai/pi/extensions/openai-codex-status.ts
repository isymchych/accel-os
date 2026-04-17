/**
 * Adds a `/status` command that shows OpenAI Codex usage and rate-limit state in an overlay.
 *
 * It reads the saved Codex OAuth credentials from Pi auth storage, calls ChatGPT's usage endpoint,
 * normalizes the response into primary/secondary limit windows, and renders the remaining quota plus
 * reset timing in a dismissible centered modal.
 */
import { AuthStorage, type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";

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

interface LimitWindow {
  usedPercent: number;
  windowSeconds?: number;
  resetsAt?: number;
}

interface StatusSnapshot {
  planType?: string;
  allowed?: boolean;
  limitReached?: boolean;
  primary?: LimitWindow;
  secondary?: LimitWindow;
  fetchedAt: number;
}

interface OAuthCredentialShape {
  type: "oauth";
  access?: string;
  expires?: number;
  accountId?: string;
}

interface CodexCredential {
  accessToken: string;
  accountId: string;
}

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK_THRESHOLD = 24;
const DAYS_PER_WEEK_THRESHOLD = 7.5;
const DAYS_PER_MONTH_THRESHOLD = 31;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOAuthCredentialShape(value: unknown): value is OAuthCredentialShape {
  return isRecord(value) && value["type"] === "oauth";
}

function clampPercent(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const encodedPayload = parts[1];
    if (encodedPayload === undefined) {
      return null;
    }

    const payload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (payload.length % 4)) % 4;
    const base64 = payload + "=".repeat(padLength);
    const json = Buffer.from(base64, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getAccountIdFromToken(token: string): string | undefined {
  const payload = parseJwtPayload(token);
  if (!payload) {
    return undefined;
  }

  const direct = payload["https://api.openai.com/auth.chatgpt_account_id"];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const auth = payload["https://api.openai.com/auth"];
  if (!isRecord(auth)) {
    return undefined;
  }

  const nested = auth["chatgpt_account_id"];
  return typeof nested === "string" && nested.length > 0 ? nested : undefined;
}

async function getCodexCredential(authStorage: AuthStorage): Promise<CodexCredential | null> {
  authStorage.reload();
  let cred = authStorage.get(PROVIDER_ID);
  if (!isOAuthCredentialShape(cred)) {
    return null;
  }

  const accessToken = await authStorage.getApiKey(PROVIDER_ID);
  if (accessToken === undefined || accessToken.length === 0) {
    return null;
  }

  authStorage.reload();
  cred = authStorage.get(PROVIDER_ID);
  if (!isOAuthCredentialShape(cred)) {
    return null;
  }

  const accountId = cred.accountId ?? getAccountIdFromToken(accessToken);
  if (accountId === undefined || accountId.length === 0) {
    throw new Error("OpenAI Codex credential is missing ChatGPT account id.");
  }

  return { accessToken, accountId };
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

  return normalizePayload(payload);
}

function describeWindow(seconds?: number): string {
  if (seconds === undefined || seconds <= 0) {
    return "limit";
  }
  const hours = seconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR);
  const days = hours / HOURS_PER_DAY;
  if (hours <= HOURS_PER_WEEK_THRESHOLD) {
    return `${Math.max(1, Math.round(hours))}h limit`;
  }
  if (days <= DAYS_PER_WEEK_THRESHOLD) {
    return "weekly limit";
  }
  if (days <= DAYS_PER_MONTH_THRESHOLD) {
    return "monthly limit";
  }
  return "usage limit";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(
    (totalSeconds % (SECONDS_PER_MINUTE * MINUTES_PER_HOUR)) / SECONDS_PER_MINUTE,
  );
  const days = Math.floor(hours / HOURS_PER_DAY);

  if (days > 0) {
    const remHours = hours % HOURS_PER_DAY;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function formatReset(timestamp?: number): string {
  if (timestamp === undefined) {
    return "reset unknown";
  }
  const diff = timestamp - Date.now();
  if (diff <= 0) {
    return "resets now";
  }
  return `resets in ${formatDuration(diff)}`;
}

function formatWindow(window: LimitWindow | undefined): string {
  if (!window) {
    return "unavailable";
  }
  const left = Math.max(0, 100 - window.usedPercent);
  return `${left}% left (${formatReset(window.resetsAt)})`;
}

function renderLines(snapshot: StatusSnapshot): string[] {
  const header =
    snapshot.planType === undefined || snapshot.planType.length === 0
      ? "OpenAI Codex"
      : `OpenAI Codex (${snapshot.planType})`;
  const statusBits: string[] = [];
  if (typeof snapshot.allowed === "boolean") {
    statusBits.push(snapshot.allowed ? "allowed" : "blocked");
  }
  if (snapshot.limitReached === true) {
    statusBits.push("limit reached");
  }

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
    private readonly theme: Theme,
    private readonly lines: readonly string[],
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return") || data.toLowerCase() === "q") {
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

  invalidate(): void {
    void this.focused;
  }

  dispose(): void {
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
        const lines = renderLines(snapshot);
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
