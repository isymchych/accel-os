import assert from "node:assert/strict";
import test from "node:test";

import {
  describeWindow,
  formatDuration,
  formatReset,
  formatWindow,
  renderProgressBar,
  renderStatusLines,
  renderWindowLine,
} from "./openai-codex-status.ts";

test("renderProgressBar draws a fixed-width bar", () => {
  assert.equal(renderProgressBar(100, 10), "[██████████]");
  assert.equal(renderProgressBar(50, 10), "[█████     ]");
  assert.equal(renderProgressBar(0, 10), "[          ]");
});

test("format helpers describe time and reset state", () => {
  assert.equal(formatDuration(999), "1s");
  assert.equal(formatDuration(61_000), "1m");
  assert.equal(formatReset(undefined, 1_000), "reset unknown");
  assert.equal(formatReset(1_000, 1_000), "resets now");
  assert.equal(formatReset(3_601_000, 1_000), "resets in 1h");
  assert.equal(
    formatWindow({ usedPercent: 9, resetsAt: 3_601_000 }, 1_000),
    "91% left (resets in 1h)",
  );
});

test("describeWindow maps durations to readable labels", () => {
  assert.equal(describeWindow(undefined), "limit");
  assert.equal(describeWindow(18_000), "5h limit");
  assert.equal(describeWindow(604_800), "weekly limit");
});

test("renderWindowLine and renderStatusLines produce the expected layout", () => {
  const line = renderWindowLine("weekly limit", { usedPercent: 9, resetsAt: 3_601_000 }, 12, 1_000);
  assert.equal(line, "weekly limit: [██████████████████  ] 91% left (resets in 1h)");

  const lines = renderStatusLines(
    {
      planType: "plus",
      accountEmail: "symchychnya@gmail.com",
      accountPlan: "plus",
      allowed: true,
      limitReached: false,
      primary: { usedPercent: 0, windowSeconds: 18_000, resetsAt: 1_000 },
      secondary: { usedPercent: 9, windowSeconds: 604_800, resetsAt: 3_601_000 },
      fetchedAt: 1_000,
    },
    1_000,
  );

  assert.deepEqual(lines, [
    "OpenAI Codex (plus)",
    "Status: allowed",
    "Account: symchychnya@gmail.com (Plus)",
    "5h limit    : [████████████████████] 100% left (resets now)",
    "weekly limit: [██████████████████  ] 91% left (resets in 1h)",
  ]);
});
