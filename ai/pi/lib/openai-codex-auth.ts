/**
 * OpenAI Codex OAuth token helpers shared by Pi account and status features.
 *
 * This module owns JWT payload decoding, saved-credential parsing, and claim extraction at the auth
 * boundary so callers can work with normalized account data instead of raw token shape details.
 */
import { isRecord } from "./guards.ts";

export interface OpenAICodexAccountProfile {
  accountId?: string;
  email?: string;
  plan?: string;
}

export interface OpenAICodexSavedCredential {
  type: "oauth";
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getNestedRecord(
  value: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function getStringRecordValue(value: Record<string, unknown> | null, key: string): string | null {
  if (value === null) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" && nested.length > 0 ? nested : null;
}

export function parseOpenAICodexCredential(
  value: unknown,
): OpenAICodexSavedCredential | null {
  if (!isRecord(value) || value["type"] !== "oauth") {
    return null;
  }

  const credential: OpenAICodexSavedCredential = { type: "oauth" };

  const access = readNonEmptyString(value["access"]);
  if (access !== undefined) {
    credential.access = access;
  }

  const refresh = readNonEmptyString(value["refresh"]);
  if (refresh !== undefined) {
    credential.refresh = refresh;
  }

  const expires = readFiniteNumber(value["expires"]);
  if (expires !== undefined) {
    credential.expires = expires;
  }

  const accountId = readNonEmptyString(value["accountId"]);
  if (accountId !== undefined) {
    credential.accountId = accountId;
  }

  return credential;
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    return null;
  }

  const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padLength);
  try {
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readOpenAICodexAccountProfile(token: string): OpenAICodexAccountProfile {
  const payload = parseJwtPayload(token);
  if (payload === null) {
    return {};
  }

  const authClaims = getNestedRecord(payload, "https://api.openai.com/auth");
  const profileClaims = getNestedRecord(payload, "https://api.openai.com/profile");
  const accountId =
    getStringRecordValue(authClaims, "chatgpt_account_id") ??
    getStringRecordValue(payload, "https://api.openai.com/auth.chatgpt_account_id");

  const profile: OpenAICodexAccountProfile = {};
  if (accountId !== null) {
    profile.accountId = accountId;
  }

  const email =
    getStringRecordValue(profileClaims, "email") ?? getStringRecordValue(payload, "email");
  if (email !== null) {
    profile.email = email;
  }

  const plan = getStringRecordValue(authClaims, "chatgpt_plan_type");
  if (plan !== null) {
    profile.plan = plan;
  }

  return profile;
}
