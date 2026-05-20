import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  executeWriteFileTool,
  writeFileSchema,
  type WriteFileInput,
  type WriteFileToolResult,
} from "./tool.ts";

async function createTempWorkspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-write-file-"));
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

async function runWriteFile(cwd: string, params: WriteFileInput): Promise<WriteFileToolResult> {
  return executeWriteFileTool("tool-call-1", params, undefined, undefined, cwd);
}

function getTextOutput(result: WriteFileToolResult): string {
  return result.content[0].text;
}

test("tool schema remains a top-level object for Pi registration", () => {
  assert.equal(writeFileSchema.type, "object");
});

test("write_file creates a new file and parent directories", async (t) => {
  const cwd = await createTempWorkspace(t);

  const result = await runWriteFile(cwd, {
    path: "src/note.txt",
    content: "alpha\nbeta\n",
    mode: "create",
  });

  assert.equal(await readWorkspaceFile(cwd, "src/note.txt"), "alpha\nbeta\n");
  assert.equal(getTextOutput(result), "Created file src/note.txt.");
  const preview = result.details.preview;
  assert.ok(preview, "Expected preview details.");
  assert.equal(preview.operation, "add");
  assert.equal(preview.added, 2);
  assert.equal(preview.removed, 0);
  const writeResult = result.details.result;
  assert.ok(writeResult, "Expected result details.");
  assert.equal(writeResult.status, "created");
  assert.match(result.details.diff, /File: .*src\/note.txt/);
  assert.equal(result.isError, undefined);
});

test("write_file replaces an existing file", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n");

  const result = await runWriteFile(cwd, {
    path: "note.txt",
    content: "one\ntwo\n",
    mode: "replace",
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "one\ntwo\n");
  assert.equal(getTextOutput(result), "Replaced file note.txt.");
  const preview = result.details.preview;
  assert.ok(preview, "Expected preview details.");
  assert.equal(preview.operation, "update");
  const writeResult = result.details.result;
  assert.ok(writeResult, "Expected result details.");
  assert.equal(writeResult.status, "replaced");
  assert.equal(writeResult.wrote, true);
  assert.equal(result.isError, undefined);
});

test("write_file treats identical replace content as unchanged", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  const result = await runWriteFile(cwd, {
    path: "note.txt",
    content: "alpha\n",
    mode: "replace",
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\n");
  assert.equal(getTextOutput(result), "Verified note.txt already matched the requested content.");
  const writeResult = result.details.result;
  assert.ok(writeResult, "Expected result details.");
  assert.equal(writeResult.status, "unchanged");
  assert.equal(writeResult.wrote, false);
  assert.equal(result.details.diff, "");
});

test("write_file fails create when the file already exists", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  const result = await runWriteFile(cwd, {
    path: "note.txt",
    content: "beta\n",
    mode: "create",
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\n");
  assert.equal(result.isError, true);
  assert.equal(result.terminate, true);
  assert.equal(
    getTextOutput(result),
    "write_file failed: Failed to create note.txt: file already exists.",
  );
});

test("write_file fails replace when the file does not exist", async (t) => {
  const cwd = await createTempWorkspace(t);

  const result = await runWriteFile(cwd, {
    path: "missing.txt",
    content: "alpha\n",
    mode: "replace",
  });

  assert.equal(await fileExists(cwd, "missing.txt"), false);
  assert.equal(result.isError, true);
  assert.equal(result.terminate, true);
  assert.equal(
    getTextOutput(result),
    "write_file failed: Failed to replace missing.txt: file does not exist.",
  );
});

test("write_file resolves @-prefixed paths without creating literal @ files", async (t) => {
  const cwd = await createTempWorkspace(t);

  const result = await runWriteFile(cwd, {
    path: "@note.txt",
    content: "alpha\n",
    mode: "create",
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\n");
  assert.equal(await fileExists(cwd, "@note.txt"), false);
  assert.equal(getTextOutput(result), "Created file note.txt.");
});
