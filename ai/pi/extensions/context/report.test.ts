import assert from "node:assert/strict";
import test from "node:test";

import { buildContextReport, renderContextReport } from "./report.ts";

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
    cacheTurns: [
      {
        sequence: 1,
        isOnActiveBranch: true,
        timestamp: "2026-05-21T12:00:00.000Z",
        provider: "openai",
        model: "gpt-5",
        input: 100,
        output: 25,
        cacheRead: 900,
        cacheWrite: 0,
        totalTokens: 1_025,
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
  assert.ok(report.buckets.some((bucket) => bucket.label === "System prompt base"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Context files"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Tool definitions"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Assistant tool calls"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Tool results"));
  assert.ok(report.buckets.some((bucket) => bucket.label === "Conversation"));
  assert.equal(report.cache.wholeTree.assistantMessages, 1);
  assert.equal(report.cache.wholeTree.cacheHitPercent, 90);
  assert.equal(report.cache.turns[0]?.cacheHitPercent, 90);
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
    cacheTurns: [
      {
        sequence: 1,
        isOnActiveBranch: true,
        timestamp: "2026-05-21T12:00:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet-4.6",
        input: 1,
        output: 120,
        cacheRead: 4_000,
        cacheWrite: 100,
        totalTokens: 4_221,
      },
      {
        sequence: 2,
        isOnActiveBranch: false,
        timestamp: "2026-05-21T12:01:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet-4.6",
        input: 100,
        output: 80,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 180,
      },
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

  assert.match(text, /^Context$/m);
  assert.match(text, /^Current context breakdown$/m);
  assert.match(text, /^Context files \(0\)$/m);
  assert.match(text, /^Active tools \(0\)$/m);
  assert.match(text, /^Cache summary$/m);
  assert.match(text, /^Per-turn cache stats$/m);
  assert.match(text, /^Notes$/m);
  assert.match(
    text,
    /Active branch: 1 turns · sent 1 · received 120 · cache hit 4,000 · hit rate 100.0%/,
  );
  assert.match(
    text,
    /Whole tree: 2 turns · sent 101 · received 200 · cache hit 4,000 · hit rate 97.5%/,
  );
  assert.match(text, /Latest 0.0% · Min 0.0% · Max 100.0%/);
  assert.match(text, /per-turn extension prompt changes appear after the next agent run/);
  assert.match(text, /Snapshot: current resources · 3 messages · 3 entries/);
  assert.match(text, /anthropic\/claude-sonnet-4.6/);
});

test("renderContextReport shows only the last 6 per-turn cache rows", () => {
  const report = buildContextReport({
    systemPrompt: "Prompt text",
    promptSource: "last-turn",
    contextUsage: undefined,
    messages: [],
    cacheTurns: Array.from({ length: 8 }, (_value, index) => ({
      sequence: index + 1,
      isOnActiveBranch: true,
      timestamp: `2026-05-21T12:0${index}:00.000Z`,
      provider: "openai",
      model: "gpt-5",
      input: index + 1,
      output: index + 10,
      cacheRead: 100 + index,
      cacheWrite: 0,
      totalTokens: 200 + index,
    })),
    allTools: [],
    activeToolNames: [],
    contextFiles: [],
    session: {
      branchEntryCount: 8,
      messageCount: 0,
      latestCompactionTokensBefore: undefined,
    },
  });

  const text = renderContextReport(report);

  assert.doesNotMatch(text, /^\s*1\s+\*/m);
  assert.doesNotMatch(text, /^\s*2\s+\*/m);
  assert.match(text, /^\s*3\s+\*/m);
  assert.match(text, /^\s*8\s+\*/m);
});
