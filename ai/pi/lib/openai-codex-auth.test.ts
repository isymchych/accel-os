import assert from "node:assert/strict";
import test from "node:test";

import {
  parseJwtPayload,
  parseOpenAICodexCredential,
  readOpenAICodexAccountProfile,
  resolveOpenAICodexRuntimeAccountProfile,
} from "./openai-codex-auth.ts";

function encodeJwtPayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function makeJwt(payload: Record<string, unknown>): string {
  return `header.${encodeJwtPayload(payload)}.signature`;
}

test("parseJwtPayload decodes the payload section", () => {
  const payload = { hello: "world", count: 3 };

  assert.deepEqual(parseJwtPayload(makeJwt(payload)), payload);
});

test("readOpenAICodexAccountProfile reads nested auth and profile claims", () => {
  const profile = readOpenAICodexAccountProfile(
    makeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-123",
        chatgpt_plan_type: "plus",
      },
      "https://api.openai.com/profile": {
        email: "symchychnya@gmail.com",
      },
    }),
  );

  assert.deepEqual(profile, {
    accountId: "acct-123",
    email: "symchychnya@gmail.com",
    plan: "plus",
  });
});

test("readOpenAICodexAccountProfile falls back to top-level claims", () => {
  const profile = readOpenAICodexAccountProfile(
    makeJwt({
      "https://api.openai.com/auth.chatgpt_account_id": "acct-456",
      email: "fallback@example.com",
    }),
  );

  assert.deepEqual(profile, {
    accountId: "acct-456",
    email: "fallback@example.com",
  });
});

test("parseOpenAICodexCredential normalizes oauth saved credentials", () => {
  assert.deepEqual(
    parseOpenAICodexCredential({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
      accountId: "acct-789",
    }),
    {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: 123,
      accountId: "acct-789",
    },
  );
});

test("parseOpenAICodexCredential rejects non-oauth values", () => {
  assert.equal(parseOpenAICodexCredential(null), null);
  assert.equal(parseOpenAICodexCredential({ type: "api_key" }), null);
});

test("readOpenAICodexAccountProfile ignores malformed payloads", () => {
  assert.deepEqual(readOpenAICodexAccountProfile("not-a-jwt"), {});
});

test("resolveOpenAICodexRuntimeAccountProfile prefers token account id over saved metadata", () => {
  const profile = resolveOpenAICodexRuntimeAccountProfile(
    {
      accountId: "acct-stale",
    },
    makeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-live",
        chatgpt_plan_type: "plus",
      },
      "https://api.openai.com/profile": {
        email: "live@example.com",
      },
    }),
  );

  assert.deepEqual(profile, {
    accountId: "acct-live",
    email: "live@example.com",
    plan: "plus",
  });
});

test("resolveOpenAICodexRuntimeAccountProfile falls back to saved account id", () => {
  const profile = resolveOpenAICodexRuntimeAccountProfile(
    {
      accountId: "acct-saved",
    },
    "not-a-jwt",
  );

  assert.deepEqual(profile, {
    accountId: "acct-saved",
  });
});

test("resolveOpenAICodexRuntimeAccountProfile works without saved credentials", () => {
  const profile = resolveOpenAICodexRuntimeAccountProfile(
    undefined,
    makeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-runtime",
        chatgpt_plan_type: "pro",
      },
      "https://api.openai.com/profile": {
        email: "runtime@example.com",
      },
    }),
  );

  assert.deepEqual(profile, {
    accountId: "acct-runtime",
    email: "runtime@example.com",
    plan: "pro",
  });
});
