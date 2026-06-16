import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompletedTimerSummary,
  createTotalElapsedSummary,
  createWorkingTimerMessage,
  estimateTokensFromTextDelta,
  formatElapsed,
} from "./timer.ts";

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
  assert.equal(
    createWorkingTimerMessage(
      1_500,
      {
        estimated: false,
        outputTokens: 170,
        streamElapsedMs: 2_000,
      },
      {
        inputTokens: 1_000,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 0,
      },
    ),
    "⏱ 1.5s · 85 tok/s · turn cache 90.0%",
  );
  assert.equal(createTotalElapsedSummary(1_500), "⏱ 1.5s");
  assert.equal(
    createCompletedTimerSummary(
      1_500,
      {
        outputTokens: 170,
        streamElapsedMs: 2_000,
      },
      {
        inputTokens: 1_000,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 0,
      },
    ),
    "⏱ 1.5s · 85 tok/s · 170 tokens · turn cache 90.0% · R9.0k",
  );
  assert.equal(
    createCompletedTimerSummary(1_500, undefined, {
      inputTokens: 1_000,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 10_000,
    }),
    "⏱ 1.5s · turn cache 45.0% · R9.0k · W10k",
  );
  assert.equal(createCompletedTimerSummary(1_500), "⏱ 1.5s");
  assert.equal(
    createCompletedTimerSummary(1_500, undefined, {
      inputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
    "⏱ 1.5s · turn cache 0.0%",
  );
  assert.equal(estimateTokensFromTextDelta("abcd"), 1);
});
