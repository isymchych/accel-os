import assert from "node:assert/strict";
import test from "node:test";

import {
  parseJwtPayload,
  parseOpenAICodexCredential,
  readOpenAICodexAccountProfile,
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
