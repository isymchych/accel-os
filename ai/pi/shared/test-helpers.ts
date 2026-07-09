import assert from "node:assert/strict";

import { isRecord } from "@accel-os/shared/guards";

export interface ToolContentBlock {
  type: string;
  text?: string;
}

export interface NormalizedToolResult<TDetails = Record<string, unknown>> {
  content: ToolContentBlock[];
  details?: TDetails;
  isError?: boolean;
  terminate?: boolean;
}

export function normalizeToolContent(content: unknown): ToolContentBlock[] {
  assert.ok(Array.isArray(content), "Expected tool result content to be an array.");

  return content.map((block) => {
    assert.ok(isRecord(block), "Expected each content block to be an object.");

    const type = block["type"];
    if (typeof type !== "string") {
      throw new Error("Expected each content block to have a string type.");
    }

    const normalizedBlock: ToolContentBlock = { type };
    const text = block["text"];
    if (typeof text === "string") {
      normalizedBlock.text = text;
    }
    return normalizedBlock;
  });
}

export function normalizeToolResult(result: unknown): NormalizedToolResult;
export function normalizeToolResult<TDetails>(
  result: unknown,
  options: {
    normalizeDetails: (details: Record<string, unknown>) => TDetails;
  },
): NormalizedToolResult<TDetails>;
export function normalizeToolResult<TDetails>(
  result: unknown,
  options?: {
    normalizeDetails: (details: Record<string, unknown>) => TDetails;
  },
): NormalizedToolResult<TDetails | Record<string, unknown>> {
  assert.ok(isRecord(result), "Expected tool result to be an object.");

  const normalizedResult: NormalizedToolResult<TDetails | Record<string, unknown>> = {
    content: normalizeToolContent(result["content"]),
  };

  const details = result["details"];
  if (details !== undefined) {
    assert.ok(isRecord(details), "Expected tool result details to be an object.");
    normalizedResult.details = options?.normalizeDetails(details) ?? details;
  }
  if (typeof result["isError"] === "boolean") {
    normalizedResult.isError = result["isError"];
  }
  if (typeof result["terminate"] === "boolean") {
    normalizedResult.terminate = result["terminate"];
  }

  return normalizedResult;
}

export function getTextOutput(result: Pick<NormalizedToolResult, "content">): string {
  const block = result.content[0];
  assert.ok(block, "Expected tool result to include a text content block.");
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected tool result to include text content.");
  }
  return block.text;
}
