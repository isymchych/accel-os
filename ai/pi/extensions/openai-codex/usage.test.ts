import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUsagePayload } from "./usage.ts";

test("normalizeUsagePayload maps ChatGPT rate-limit payloads", () => {
  const snapshot = normalizeUsagePayload(
    {
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: "20.4",
          limit_window_seconds: 18_000,
          reset_after_seconds: 60,
        },
        secondary_window: {
          used_percent: 9,
          limit_window_seconds: 604_800,
          reset_at: 10,
        },
      },
    },
    1_000,
  );

  assert.deepEqual(snapshot, {
    planType: "plus",
    allowed: true,
    limitReached: false,
    primary: { usedPercent: 20, windowSeconds: 18_000, resetsAt: 61_000 },
    secondary: { usedPercent: 9, windowSeconds: 604_800, resetsAt: 10_000 },
    fetchedAt: 1_000,
  });
});

test("normalizeUsagePayload clamps malformed usage percentages", () => {
  const snapshot = normalizeUsagePayload({ rate_limit: { primary_window: { used_percent: 150 } } });
  assert.equal(snapshot.primary?.usedPercent, 100);

  const missing = normalizeUsagePayload({
    rate_limit: { primary_window: { used_percent: "nope" } },
  });
  assert.equal(missing.primary?.usedPercent, 0);
});
