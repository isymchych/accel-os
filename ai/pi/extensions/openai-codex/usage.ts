/**
 * OpenAI Codex usage API boundary.
 *
 * This module owns the ChatGPT usage endpoint schema, normalization, and request headers so Pi UI
 * features and CLI account tooling can share one canonical implementation.
 */
import { isRecord } from "../../shared/guards.ts";
import type { LimitWindow, StatusSnapshot } from "./status.ts";

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

export interface OpenAICodexUsageCredential {
  accessToken: string;
  accountId: string;
  email?: string;
  plan?: string;
}

interface FetchUsageOptions {
  signal?: AbortSignal;
}

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
  now: number,
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
    normalized.resetsAt = now + resetAfterSeconds * MS_PER_SECOND;
  }

  if (typeof window.limit_window_seconds === "number") {
    normalized.windowSeconds = window.limit_window_seconds;
  }

  return normalized;
}

export function normalizeUsagePayload(
  payload: RawRateLimitStatusPayload,
  now = Date.now(),
): StatusSnapshot {
  const snapshot: StatusSnapshot = {
    fetchedAt: now,
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

  const primary = normalizeWindow(payload.rate_limit?.primary_window, now);
  if (primary !== undefined) {
    snapshot.primary = primary;
  }

  const secondary = normalizeWindow(payload.rate_limit?.secondary_window, now);
  if (secondary !== undefined) {
    snapshot.secondary = secondary;
  }

  return snapshot;
}

export async function fetchUsageSnapshotForCredential(
  credential: OpenAICodexUsageCredential,
  options: FetchUsageOptions = {},
): Promise<StatusSnapshot> {
  const requestInit: RequestInit = {
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.accountId,
      "User-Agent": "pi-openai-codex-usage",
    },
    method: "GET",
  };
  if (options.signal !== undefined) {
    requestInit.signal = options.signal;
  }

  const response = await fetch(USAGE_URL, requestInit);

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

  const snapshot = normalizeUsagePayload(payload);
  if (credential.email !== undefined && credential.email.length > 0) {
    snapshot.accountEmail = credential.email;
  }
  if (credential.plan !== undefined && credential.plan.length > 0) {
    snapshot.accountPlan = credential.plan;
  }

  return snapshot;
}
