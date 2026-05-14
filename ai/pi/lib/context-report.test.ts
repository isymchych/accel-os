import assert from "node:assert/strict";
import test from "node:test";

import { buildContextReport, renderContextReport } from "./context-report.ts";

test("buildContextReport normalizes bucket totals to Pi's exact usage", () => {
  const report = buildContextReport({
    systemPrompt: "System prompt text",
    promptSource: "last-turn",
    contextUsage: {
      tokens: 1_000,
      contextWindow: 2_000,
      percent: 50,
    },
    messages: [
      { role: "user", content: "hello world" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "response" },
          { type: "toolCall", name: "read", arguments: { path: "foo.ts" } },
        ],
      },
      {
        role: "toolResult",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
      },
    ],
    allTools: [
      {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        sourceInfo: {
          path: "<builtin:read>",
          source: "builtin",
          scope: "temporary",
          origin: "top-level",
        },
      },
    ],
    activeToolNames: ["read"],
    contextFiles: [{ path: "/repo/AGENTS.md", content: "rules" }],
    session: {
      branchEntryCount: 6,
      messageCount: 3,
      latestCompactionTokensBefore: undefined,
    },
  });

  assert.equal(report.usedTokens, 1_000);
  assert.equal(report.availableTokens, 1_000);
  assert.equal(report.usedTokensExact, true);
  assert.equal(
    report.buckets
      .filter((bucket) => bucket.depth === 0)
      .reduce((sum, bucket) => sum + bucket.tokens, 0),
    1_000,
  );
  assert.ok(report.buckets.some((bucket) => bucket.label === "System Prompt"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "System Tools"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Assistant Tool Calls"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Tool Results"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Messages"));
});

test("renderContextReport produces the expected sections", () => {
  const report = buildContextReport({
    systemPrompt: "Prompt text",
    promptSource: "current",
    contextUsage: undefined,
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "thinking", thinking: "plan" }] },
      { role: "bashExecution", command: "pwd", output: "/tmp\n" },
    ],
    allTools: [],
    activeToolNames: [],
    contextFiles: [],
    session: {
      branchEntryCount: 3,
      messageCount: 3,
      latestCompactionTokensBefore: undefined,
    },
  });

  const text = renderContextReport(report);

  assert.match(text, /^Estimated Usage/m);
  assert.match(text, /^Snapshot$/m);
  assert.match(text, /^Context files \(0\)$/m);
  assert.match(text, /^Active tools \(0\)$/m);
  assert.match(text, /^Notes$/m);
  assert.match(text, /per-turn extension prompt changes appear after the next agent run/);
  assert.match(text, /Active path: 3 messages, 3 entries/);
});
