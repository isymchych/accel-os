import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, UserMessage, Usage } from "@earendil-works/pi-ai";

import {
  createCompletedTimerSummary,
  createTotalElapsedSummary,
  createWorkingTimerMessage,
  estimateTokensFromTextDelta,
  formatElapsed,
  stripResponseTimerFromMessage,
} from "./timer.ts";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function createAssistantMessage(
  content: AssistantMessage["content"],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-chat",
    provider: "openai",
    model: "test-model",
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

function createUserMessage(content: UserMessage["content"]): UserMessage {
  return {
    role: "user",
    content,
    timestamp: 0,
  };
}

test("formatElapsed formats sub-minute and minute durations", () => {
  assert.equal(formatElapsed(1_500), "1.5s");
  assert.equal(formatElapsed(59_900), "59.9s");
  assert.equal(formatElapsed(60_000), "1m 0s");
  assert.equal(formatElapsed(125_000), "2m 5s");
});

test("timer text helpers use the expected prefixes", () => {
  assert.equal(createWorkingTimerMessage(1_500), "⏱ 1.5s");
  assert.equal(
    createWorkingTimerMessage(1_500, {
      estimated: false,
      outputTokens: 170,
      streamElapsedMs: 2_000,
    }),
    "⏱ 1.5s · 85 tok/s",
  );
  assert.equal(
    createWorkingTimerMessage(1_500, {
      estimated: true,
      outputTokens: 170,
      streamElapsedMs: 2_000,
    }),
    "⏱ 1.5s · ~85 tok/s",
  );
  assert.equal(createTotalElapsedSummary(1_500), "⏱ 1.5s");
  assert.equal(
    createCompletedTimerSummary(1_500, {
      outputTokens: 170,
      streamElapsedMs: 2_000,
    }),
    "⏱ 1.5s · 85 tok/s · 170 tokens",
  );
  assert.equal(createCompletedTimerSummary(1_500), "⏱ 1.5s");
  assert.equal(estimateTokensFromTextDelta("abcd"), 1);
});

test("stripResponseTimerFromMessage removes only a trailing assistant timer block", () => {
  const message = createAssistantMessage([
    { type: "text", text: "hello" },
    { type: "text", text: "\n\n⏱ 1.5s" },
  ]);

  assert.deepEqual(
    stripResponseTimerFromMessage(message),
    createAssistantMessage([{ type: "text", text: "hello" }]),
  );
});

test("stripResponseTimerFromMessage leaves non-trailing and non-assistant messages unchanged", () => {
  const assistantMessage = createAssistantMessage([
    { type: "text", text: "\n\n⏱ 1.5s" },
    { type: "text", text: "hello" },
  ]);
  const userMessage = createUserMessage("hello");

  assert.equal(stripResponseTimerFromMessage(assistantMessage), assistantMessage);
  assert.equal(stripResponseTimerFromMessage(userMessage), userMessage);
});
