import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { executeMultiEditTool, multiEditSchema, type MultiEditInput } from "./multi-edit.ts";

interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  details?: {
    diff?: string;
    firstChangedLine?: number;
  };
}

async function createTempWorkspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-multi-edit-"));
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

async function readWorkspaceFile(cwd: string, relativePath: string): Promise<string> {
  return readFile(join(cwd, relativePath), "utf-8");
}

async function fileExists(cwd: string, relativePath: string): Promise<boolean> {
  try {
    await stat(join(cwd, relativePath));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeToolResult(result: unknown): ToolResult {
  assert.ok(isRecord(result), "Expected tool result to be an object.");

  const { content, details } = result;
  assert.ok(Array.isArray(content), "Expected tool result content to be an array.");

  const normalizedContent = content.map((block) => {
    assert.ok(isRecord(block), "Expected each content block to be an object.");

    const type = block["type"];
    if (typeof type !== "string") {
      throw new Error("Expected each content block to have a string type.");
    }

    const normalizedBlock: ToolResult["content"][number] = { type };
    const text = block["text"];
    if (typeof text === "string") {
      normalizedBlock.text = text;
    }
    return normalizedBlock;
  });

  if (details === undefined) {
    return { content: normalizedContent };
  }

  assert.ok(isRecord(details), "Expected tool result details to be an object.");

  const normalizedDetails: NonNullable<ToolResult["details"]> = {};
  const diff = details["diff"];
  if (typeof diff === "string") {
    normalizedDetails.diff = diff;
  }
  const firstChangedLine = details["firstChangedLine"];
  if (typeof firstChangedLine === "number") {
    normalizedDetails.firstChangedLine = firstChangedLine;
  }

  return {
    content: normalizedContent,
    details: normalizedDetails,
  };
}

async function runEdit(cwd: string, params: MultiEditInput): Promise<ToolResult> {
  const result = await executeMultiEditTool("tool-call-1", params, undefined, undefined, cwd);
  return normalizeToolResult(result);
}

function getTextOutput(result: ToolResult): string {
  const block = result.content[0];
  assert.ok(block, "Expected tool result to include a text content block.");
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected tool result to include text content.");
  }
  return block.text;
}

function getDiff(result: ToolResult): string {
  if (result.details === undefined) {
    throw new Error("Expected tool result to include details.");
  }
  return result.details.diff ?? "";
}

test("tool schema remains a top-level object for Pi registration", () => {
  assert.equal(multiEditSchema.type, "object");
});

test("path + edits[] applies replacements against the original file", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n");

  const result = await runEdit(cwd, {
    path: "note.txt",
    edits: [
      { oldText: "alpha", newText: "one" },
      { oldText: "beta", newText: "two" },
    ],
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "one\ntwo\n");
  assert.equal(
    getTextOutput(result),
    "Applied 2 edit(s) successfully.\n1. Edited note.txt.\n2. Edited note.txt.",
  );
  assert.equal(result.details?.firstChangedLine, 1);
  assert.match(getDiff(result), /File: note\.txt/);
  assert.match(getDiff(result), /one/);
  assert.match(getDiff(result), /two/);
});

test("multi applies cross-file edits", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "first\nmiddle\nlast\n");
  await writeWorkspaceFile(cwd, "b.txt", "beta\n");

  const result = await runEdit(cwd, {
    path: "a.txt",
    multi: [
      { oldText: "last", newText: "third" },
      { oldText: "first", newText: "one" },
      { path: "b.txt", oldText: "beta", newText: "two" },
    ],
  });

  assert.equal(await readWorkspaceFile(cwd, "a.txt"), "one\nmiddle\nthird\n");
  assert.equal(await readWorkspaceFile(cwd, "b.txt"), "two\n");
  assert.equal(
    getTextOutput(result),
    "Applied 3 edit(s) successfully.\n1. Edited a.txt.\n2. Edited a.txt.\n3. Edited b.txt.",
  );
  assert.equal(result.details?.firstChangedLine, 1);
  assert.match(getDiff(result), /File: a\.txt/);
  assert.match(getDiff(result), /File: b\.txt/);
});

test("duplicate edits that target the same original span are rejected", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "hello\n");

  await assert.rejects(
    async () =>
      runEdit(cwd, {
        path: "note.txt",
        multi: [
          { oldText: "hello", newText: "goodbye" },
          { oldText: "hello", newText: "hi" },
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Preflight failed before mutating files\./);
      assert.match(error.message, /requested replacements overlap in the original file/);
      return true;
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "hello\n");
});

test("ambiguous oldText matches are rejected", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "repeat\nrepeat\n");

  await assert.rejects(
    async () =>
      runEdit(cwd, {
        path: "note.txt",
        edits: [{ oldText: "repeat", newText: "once" }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /must be unique in the original file/);
      return true;
    },
  );
});

test("failed multi preflight leaves every file unchanged", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "b.txt", "beta\n");

  await assert.rejects(
    async () =>
      runEdit(cwd, {
        multi: [
          { path: "a.txt", oldText: "alpha", newText: "one" },
          { path: "b.txt", oldText: "missing", newText: "two" },
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Preflight failed before mutating files\./);
      assert.match(error.message, /must match exactly once in the original file/);
      return true;
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "a.txt"), "alpha\n");
  assert.equal(await readWorkspaceFile(cwd, "b.txt"), "beta\n");
});

test("mixed request modes are rejected", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  await assert.rejects(
    async () =>
      runEdit(cwd, {
        path: "note.txt",
        edits: [{ oldText: "alpha", newText: "one" }],
        oldText: "alpha",
        newText: "two",
      } as MultiEditInput),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /must use exactly one mode/);
      return true;
    },
  );
});

test("patch applies add, update, and delete operations", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "keep.txt", "alpha\nbeta\n");
  await writeWorkspaceFile(cwd, "remove.txt", "gone\n");

  const result = await runEdit(cwd, {
    patch: `*** Begin Patch
*** Add File: added.txt
+hello
+world
*** Update File: keep.txt
@@
-alpha
+one
 beta
*** Delete File: remove.txt
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "added.txt"), "hello\nworld");
  assert.equal(await readWorkspaceFile(cwd, "keep.txt"), "one\nbeta\n");
  assert.equal(await fileExists(cwd, "remove.txt"), false);
  assert.equal(
    getTextOutput(result),
    "Applied patch with 3 operation(s).\n1. Added file added.txt.\n2. Updated keep.txt.\n3. Deleted file remove.txt.",
  );
  assert.equal(result.details?.firstChangedLine, 1);
  assert.match(getDiff(result), /File: added.txt/);
  assert.match(getDiff(result), /File: keep.txt/);
  assert.match(getDiff(result), /File: remove.txt/);
});

test("patch update preserves a file without a trailing newline", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta");

  await runEdit(cwd, {
    patch: `*** Begin Patch
*** Update File: note.txt
@@
-alpha
+one
 beta
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "one\nbeta");
});
