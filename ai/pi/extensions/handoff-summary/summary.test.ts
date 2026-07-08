import assert from "node:assert/strict";
import test from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  buildCompactionPrompt,
  buildSharedContextEntries,
  calculateSummaryTokenBudgets,
  computeFileLists,
  formatFileOperations,
  hasRequiredHeadings,
} from "./summary.ts";

function entry(id: string): SessionEntry {
  return {
    type: "label",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    targetId: id,
    label: undefined,
  };
}

test("calculateSummaryTokenBudgets keeps useful input budget for small context models", () => {
  const result = calculateSummaryTokenBudgets(
    { contextWindow: 8192, maxTokens: 4096 },
    { includeSharedContext: true },
  );

  assert.deepEqual(result, {
    ok: true,
    budgets: {
      sharedContext: 1638,
      mainInput: 2458,
      response: 2048,
    },
  });
});

test("calculateSummaryTokenBudgets rejects unusable context budgets", () => {
  const result = calculateSummaryTokenBudgets(
    { contextWindow: 4096, maxTokens: 4096 },
    { includeSharedContext: true },
  );

  assert.deepEqual(result, {
    ok: false,
    error: "insufficient context budget: 205 tokens available for conversation input",
  });
});

test("hasRequiredHeadings requires real markdown headings", () => {
  assert.equal(
    hasRequiredHeadings("## Goal\ntext\n## Next Concrete Action\n1. go", [
      "Goal",
      "Next Concrete Action",
    ]),
    true,
  );
  assert.equal(
    hasRequiredHeadings("text mentions ## Goal inline\n## Next Concrete Action", [
      "Goal",
      "Next Concrete Action",
    ]),
    false,
  );
});

test("computeFileLists sorts modified files and excludes them from read files", () => {
  assert.deepEqual(
    computeFileLists({
      read: new Set(["b.ts", "a.ts", "c.ts"]),
      written: new Set(["c.ts"]),
      edited: new Set(["b.ts", "b.ts"]),
    }),
    {
      readFiles: ["a.ts"],
      modifiedFiles: ["b.ts", "c.ts"],
    },
  );
});

test("formatFileOperations includes counts for auditable metadata", () => {
  assert.equal(
    formatFileOperations(["a.ts"], ["b.ts", "c.ts"]),
    '\n\n<read-files count="1">\na.ts\n</read-files>\n\n<modified-files count="2">\nb.ts\nc.ts\n</modified-files>',
  );
});

test("buildSharedContextEntries returns entries through common ancestor", () => {
  assert.deepEqual(
    buildSharedContextEntries([entry("root"), entry("middle"), entry("leaf")], "middle"),
    [entry("root"), entry("middle")],
  );
  assert.deepEqual(buildSharedContextEntries([entry("root")], "missing"), []);
  assert.deepEqual(buildSharedContextEntries([entry("root")], null), []);
});

test("buildCompactionPrompt explains previous summary and split-turn merge behavior", () => {
  const prompt = buildCompactionPrompt(
    "new messages",
    "early oversized turn",
    "old summary",
    "focus on blockers",
  );

  assert.match(prompt, /<previous-summary>\nold summary\n<\/previous-summary>/u);
  assert.match(prompt, /<split-turn-prefix>\nearly oversized turn\n<\/split-turn-prefix>/u);
  assert.match(prompt, /NEW conversation messages to incorporate/u);
  assert.match(prompt, /Additional focus:\nfocus on blockers/u);
});
