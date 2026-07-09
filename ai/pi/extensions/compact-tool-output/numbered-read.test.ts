import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { isRecord } from "@accel-os/shared/guards";

import { getTextOutput, normalizeToolResult } from "../../shared/test-helpers.ts";
import { executeNumberedRead, type NumberedReadInput } from "./numbered-read.ts";

interface NumberedReadToolDetails {
  truncation?: {
    truncated: boolean;
    truncatedBy: "lines" | "bytes" | null;
    outputLines: number;
    firstLineExceedsLimit: boolean;
  };
}

interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  details?: NumberedReadToolDetails;
}

async function createTempWorkspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-read-numbered-"));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

async function writeWorkspaceFile(
  cwd: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = join(cwd, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
}

function normalizeNumberedReadDetails(details: Record<string, unknown>): NumberedReadToolDetails {
  const normalizedDetails: NumberedReadToolDetails = {};
  const truncation = details["truncation"];

  if (isRecord(truncation)) {
    normalizedDetails.truncation = {
      truncated: truncation["truncated"] === true,
      truncatedBy:
        truncation["truncatedBy"] === "lines" || truncation["truncatedBy"] === "bytes"
          ? truncation["truncatedBy"]
          : null,
      outputLines: typeof truncation["outputLines"] === "number" ? truncation["outputLines"] : 0,
      firstLineExceedsLimit: truncation["firstLineExceedsLimit"] === true,
    };
  }

  return normalizedDetails;
}

async function runRead(cwd: string, params: NumberedReadInput): Promise<ToolResult> {
  const result = await executeNumberedRead(params, cwd);
  return normalizeToolResult<NumberedReadToolDetails>(result, {
    normalizeDetails: normalizeNumberedReadDetails,
  });
}

test("numbered read formats a selected line range with absolute line numbers", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n\ndelta\nepsilon");

  const result = await runRead(cwd, {
    path: "note.txt",
    offset: 2,
    limit: 3,
  });

  assert.equal(
    getTextOutput(result),
    "2\tbeta\n3\t\n4\tdelta\n\n[1 more lines in file. Use offset=5 to continue.]",
  );
  assert.equal(result.details, undefined);
});

test("numbered read rejects offsets beyond the end of the file", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta");

  await assert.rejects(
    async () => runRead(cwd, { path: "note.txt", offset: 3 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Offset 3 is beyond end of file \(2 lines total\)/);
      return true;
    },
  );
});

test("numbered read preserves line-limit truncation hints", async (t) => {
  const cwd = await createTempWorkspace(t);
  const lines = Array.from({ length: 2005 }, (_, index) => `line-${index + 1}`).join("\n");
  await writeWorkspaceFile(cwd, "large.txt", lines);

  const result = await runRead(cwd, { path: "large.txt" });
  const output = getTextOutput(result);

  assert.match(output, /^\s*1\tline-1/m);
  assert.match(output, /^2000\tline-2000/m);
  assert.match(output, /\[Showing lines 1-2000 of 2005\. Use offset=2001 to continue\.\]$/);
  const truncation = result.details?.truncation;
  assert.ok(truncation);
  assert.equal(truncation.truncated, true);
  assert.equal(truncation.truncatedBy, "lines");
  assert.equal(truncation.outputLines, 2000);
});

test("numbered read reports when the first numbered line exceeds the byte limit", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "huge.txt", `${"x".repeat(60 * 1024)}\nsmall`);

  const result = await runRead(cwd, { path: "huge.txt" });

  assert.match(getTextOutput(result), /\[Line 1 is 60\.0KB, exceeds 50\.0KB limit\./);
  const truncation = result.details?.truncation;
  assert.ok(truncation);
  assert.equal(truncation.truncated, true);
  assert.equal(truncation.truncatedBy, "bytes");
  assert.equal(truncation.firstLineExceedsLimit, true);
});
