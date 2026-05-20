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
