/**
 * OpenAI Codex OAuth token helpers shared by Pi account and status features.
 *
 * This module owns JWT payload decoding, saved-credential parsing, and claim extraction at the auth
 * boundary so callers can work with normalized account data instead of raw token shape details.
 */
import { assertSchema, parseJsonWithSchema } from "@accel-os/shared/json";
import { Type, type Static } from "typebox";

import { isRecord } from "../../shared/guards.ts";

const jwtPayloadSchema = Type.Record(Type.String(), Type.Unknown());
type JwtPayload = Static<typeof jwtPayloadSchema>;

const openAICodexSavedCredentialSchema = Type.Object({
  type: Type.Literal("oauth"),
  access: Type.Optional(Type.String({ minLength: 1 })),
  refresh: Type.Optional(Type.String({ minLength: 1 })),
  expires: Type.Optional(Type.Number()),
  accountId: Type.Optional(Type.String({ minLength: 1 })),
});

export interface OpenAICodexAccountProfile {
  accountId?: string;
  email?: string;
  plan?: string;
}

export type OpenAICodexSavedCredential = Static<typeof openAICodexSavedCredentialSchema>;

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

export function parseOpenAICodexCredential(value: unknown): OpenAICodexSavedCredential | null {
  try {
    assertSchema(value, openAICodexSavedCredentialSchema, "OpenAI Codex credential");
  } catch {
    return null;
  }

  const credential: OpenAICodexSavedCredential = { type: value.type };
  if (value.access !== undefined) {
    credential.access = value.access;
  }
  if (value.refresh !== undefined) {
    credential.refresh = value.refresh;
  }
  if (value.expires !== undefined) {
    credential.expires = value.expires;
  }
  if (value.accountId !== undefined) {
    credential.accountId = value.accountId;
  }
  return credential;
}

export function parseJwtPayload(token: string): JwtPayload | null {
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
    return parseJsonWithSchema(json, jwtPayloadSchema, "JWT payload");
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

/**
 * Resolve the runtime OpenAI Codex account identity.
 *
 * The access token is the freshest account source, so token claims win over persisted file metadata.
 * Persisted `accountId` remains a fallback for older or partial token payloads.
 */
export function resolveOpenAICodexRuntimeAccountProfile(
  credential: Pick<OpenAICodexSavedCredential, "accountId"> | null | undefined,
  accessToken: string | undefined,
): OpenAICodexAccountProfile {
  const profile = accessToken === undefined ? {} : readOpenAICodexAccountProfile(accessToken);
  const accountId = profile.accountId ?? credential?.accountId;
  if (accountId === undefined) {
    return profile;
  }
  return {
    ...profile,
    accountId,
  };
}
