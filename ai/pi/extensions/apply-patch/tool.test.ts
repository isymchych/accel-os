import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  applyPatchSchema,
  executeApplyPatchTool,
  prepareApplyPatchArguments,
  type ApplyPatchInput,
} from "./tool.ts";

interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  details?: {
    diff?: string;
    firstChangedLine?: number;
    preview?: {
      files: Array<{
        filePath: string;
        moveTo?: string;
        operation: string;
        diff: string;
        added: number;
        removed: number;
      }>;
      added: number;
      removed: number;
    };
    progress?: {
      phase?: string;
      applied: number;
      failed: number;
      total: number;
      current?: {
        index: number;
        filePath: string;
        moveTo?: string;
        operation: string;
        added: number;
        removed: number;
      };
    };
    result?: {
      summaries: string[];
      appliedFiles: string[];
      failures: Array<{
        filePath: string;
        operation: string;
        message: string;
        recoveryPaths?: string[];
        wroteFiles?: string[];
      }>;
      hasPartialSuccess: boolean;
      recoveryInstructions: {
        mustReadFiles: string[];
        mustNotReadFiles: string[];
      };
      details: {
        fuzz: number;
      };
    };
  };
  isError?: boolean;
  terminate?: boolean;
}

interface ToolUpdate {
  content: Array<{
    type: string;
    text?: string;
  }>;
  details?: {
    progress?: {
      phase?: string;
      applied: number;
      failed: number;
      total: number;
      current?: {
        index: number;
        filePath: string;
        moveTo?: string;
        operation: string;
        added: number;
        removed: number;
      };
    };
  };
}

async function createTempWorkspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-apply-patch-"));
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

  const normalizedResult: ToolResult = { content: normalizedContent };

  if (details !== undefined) {
    assert.ok(isRecord(details), "Expected tool result details to be an object.");
    normalizedResult.details = details as NonNullable<ToolResult["details"]>;
  }
  if (typeof result["isError"] === "boolean") {
    normalizedResult.isError = result["isError"];
  }
  if (typeof result["terminate"] === "boolean") {
    normalizedResult.terminate = result["terminate"];
  }

  return normalizedResult;
}

async function runApplyPatch(
  cwd: string,
  params: ApplyPatchInput,
  options?: {
    onUpdate?: (partial: ToolUpdate) => void;
    createRealWorkspace?: () => {
      readText: (absolutePath: string) => Promise<string>;
      writeText: (absolutePath: string, content: string) => Promise<void>;
      deleteFile: (absolutePath: string) => Promise<void>;
      renameFile: (fromPath: string, toPath: string) => Promise<void>;
      exists: (absolutePath: string) => Promise<boolean>;
    };
  },
): Promise<{ result: ToolResult; updates: ToolUpdate[] }> {
  const updates: ToolUpdate[] = [];
  const executionOptions =
    options?.createRealWorkspace === undefined
      ? undefined
      : { createRealWorkspace: options.createRealWorkspace };
  const result = await executeApplyPatchTool(
    "tool-call-1",
    params,
    undefined,
    (partial) => {
      updates.push(partial);
      options?.onUpdate?.(partial);
    },
    cwd,
    executionOptions,
  );
  return { result: normalizeToolResult(result), updates };
}

function getTextOutput(result: ToolResult): string {
  const block = result.content[0];
  assert.ok(block, "Expected tool result to include a text content block.");
  if (block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected tool result to include text content.");
  }
  return block.text;
}

test("tool schema remains a top-level object for Pi registration", () => {
  assert.equal(applyPatchSchema.type, "object");
});

test("prepareArguments accepts raw strings and legacy patch objects", () => {
  assert.deepEqual(prepareApplyPatchArguments("*** Begin Patch\n*** End Patch"), {
    input: "*** Begin Patch\n*** End Patch",
  });
  assert.deepEqual(prepareApplyPatchArguments({ patch: "*** Begin Patch\n*** End Patch" }), {
    input: "*** Begin Patch\n*** End Patch",
  });
});

test("apply_patch adds, updates, and deletes files", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "keep.txt", "alpha\nbeta\n");
  await writeWorkspaceFile(cwd, "remove.txt", "gone\n");

  const { result, updates } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
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
  assert.equal(result.isError, undefined);
  const details = result.details;
  assert.ok(details);
  const progress = details.progress;
  assert.ok(progress);
  assert.equal(progress.phase, "done");
  assert.equal(progress.applied, 3);
  assert.equal(progress.failed, 0);
  assert.equal(progress.total, 3);
  assert.match(details.diff ?? "", /File: added.txt/);
  assert.match(details.diff ?? "", /File: keep.txt/);
  assert.match(details.diff ?? "", /File: remove.txt/);
  assert.equal(updates.length, 10);
  assert.deepEqual(
    updates.map((update) => update.details?.progress),
    [
      {
        phase: "preflight",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 1,
          filePath: "added.txt",
          operation: "add",
          added: 0,
          removed: 0,
        },
      },
      {
        phase: "preflight",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 2,
          filePath: "keep.txt",
          operation: "update",
          added: 0,
          removed: 0,
        },
      },
      {
        phase: "preflight",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 3,
          filePath: "remove.txt",
          operation: "delete",
          added: 0,
          removed: 0,
        },
      },
      {
        phase: "revalidate",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 1,
          filePath: "added.txt",
          operation: "add",
          added: 2,
          removed: 0,
        },
      },
      {
        phase: "revalidate",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 2,
          filePath: "keep.txt",
          operation: "update",
          added: 1,
          removed: 1,
        },
      },
      {
        phase: "revalidate",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 3,
          filePath: "remove.txt",
          operation: "delete",
          added: 0,
          removed: 1,
        },
      },
      {
        phase: "apply",
        applied: 0,
        failed: 0,
        total: 3,
        current: {
          index: 1,
          filePath: "added.txt",
          operation: "add",
          added: 2,
          removed: 0,
        },
      },
      {
        phase: "apply",
        applied: 1,
        failed: 0,
        total: 3,
        current: {
          index: 2,
          filePath: "keep.txt",
          operation: "update",
          added: 1,
          removed: 1,
        },
      },
      {
        phase: "apply",
        applied: 2,
        failed: 0,
        total: 3,
        current: {
          index: 3,
          filePath: "remove.txt",
          operation: "delete",
          added: 0,
          removed: 1,
        },
      },
      { phase: "apply", applied: 3, failed: 0, total: 3 },
    ],
  );
});

test("apply_patch progress identifies the current move target while pending", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src.txt", "alpha\n");

  const { updates } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: src.txt
*** Move to: moved.txt
*** End Patch`,
  });

  assert.deepEqual(updates[0]?.details?.progress, {
    phase: "preflight",
    applied: 0,
    failed: 0,
    total: 1,
    current: {
      index: 1,
      filePath: "src.txt",
      moveTo: "moved.txt",
      operation: "update",
      added: 0,
      removed: 0,
    },
  });
  assert.deepEqual(updates[1]?.details?.progress, {
    phase: "revalidate",
    applied: 0,
    failed: 0,
    total: 1,
    current: {
      index: 1,
      filePath: "src.txt",
      moveTo: "moved.txt",
      operation: "update",
      added: 0,
      removed: 0,
    },
  });
  assert.deepEqual(updates[2]?.details?.progress, {
    phase: "apply",
    applied: 0,
    failed: 0,
    total: 1,
    current: {
      index: 1,
      filePath: "src.txt",
      moveTo: "moved.txt",
      operation: "update",
      added: 0,
      removed: 0,
    },
  });
  assert.deepEqual(updates[3]?.details?.progress, {
    phase: "apply",
    applied: 1,
    failed: 0,
    total: 1,
  });
});

test("apply_patch yields after progress updates so the UI can render them before writes", async (t) => {
  const cwd = await createTempWorkspace(t);

  let progressFlushed = false;
  let writeObservedFlushedProgress = false;
  const injectedWorkspace = {
    readText: async (absolutePath: string): Promise<string> => readFile(absolutePath, "utf-8"),
    writeText: async (absolutePath: string, content: string): Promise<void> => {
      writeObservedFlushedProgress = progressFlushed;
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
    },
    deleteFile: async (absolutePath: string): Promise<void> => {
      await unlink(absolutePath);
    },
    renameFile: async (fromPath: string, toPath: string): Promise<void> => {
      await mkdir(dirname(toPath), { recursive: true });
      await rename(fromPath, toPath);
    },
    exists: async (absolutePath: string): Promise<boolean> => {
      try {
        await access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
  };

  await runApplyPatch(
    cwd,
    {
      input: `*** Begin Patch
*** Add File: added.txt
+hello
*** End Patch`,
    },
    {
      onUpdate: () => {
        setImmediate(() => {
          progressFlushed = true;
        });
      },
      createRealWorkspace: () => injectedWorkspace,
    },
  );

  assert.equal(writeObservedFlushedProgress, true);
});

test("apply_patch supports move-only updates", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src.txt", "alpha\n");

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: src.txt
*** Move to: moved.txt
*** End Patch`,
  });

  assert.equal(await fileExists(cwd, "src.txt"), false);
  assert.equal(await readWorkspaceFile(cwd, "moved.txt"), "alpha\n");
  assert.equal(
    getTextOutput(result),
    "Applied patch with 1 operation(s).\n1. Moved src.txt to moved.txt.",
  );
  assert.equal(result.details?.preview?.files[0]?.moveTo, "moved.txt");
});

test("apply_patch supports move with content changes and end-of-file hunks", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src/app.ts", "first\nsecond\nthird\n");

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: src/app.ts
*** Move to: src/main.ts
@@
-first
+one
 second
 third
*** End of File
*** End Patch`,
  });

  assert.equal(await fileExists(cwd, "src/app.ts"), false);
  assert.equal(await readWorkspaceFile(cwd, "src/main.ts"), "one\nsecond\nthird\n");
  assert.equal(
    getTextOutput(result),
    "Applied patch with 1 operation(s).\n1. Updated src/app.ts and moved it to src/main.ts.",
  );
  assert.match(result.details?.diff ?? "", /File: src\/app.ts -> src\/main.ts/);
});

test("apply_patch accepts heredoc-wrapped input", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  await runApplyPatch(cwd, {
    input: `<<'PATCH'
*** Begin Patch
*** Update File: note.txt
@@
-alpha
+beta
*** End Patch
PATCH`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "beta\n");
});

test("apply_patch preserves files when preflight fails", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  await assert.rejects(
    async () =>
      runApplyPatch(cwd, {
        input: `*** Begin Patch
*** Update File: note.txt
@@
-missing
+beta
*** End Patch`,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Preflight failed before mutating files\./);
      assert.match(error.message, /Failed to find expected lines in note\.txt/);
      return true;
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\n");
});

test("apply_patch reports partial failure and keeps earlier successes", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "b.txt", "beta\n");

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: a.txt
@@
-alpha
+one
*** Update File: b.txt
*** Move to: c.txt
@@
-beta
+two
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "a.txt"), "one\n");
  assert.equal(await fileExists(cwd, "b.txt"), false);
  assert.equal(await readWorkspaceFile(cwd, "c.txt"), "two\n");
  assert.equal(result.isError, undefined);
});

test("apply_patch marks partial failure as an error when a later operation fails", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "b.txt", "beta\n");

  let injectedConflict = false;
  const { result } = await runApplyPatch(
    cwd,
    {
      input: `*** Begin Patch
*** Update File: a.txt
@@
-alpha
+one
*** Update File: b.txt
*** Move to: c.txt
*** End Patch`,
    },
    {
      onUpdate: (partial) => {
        const progress = partial.details?.progress;
        if (injectedConflict || progress?.applied !== 1 || progress.failed !== 0) {
          return;
        }
        writeFileSync(join(cwd, "c.txt"), "existing\n", "utf-8");
        injectedConflict = true;
      },
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "a.txt"), "one\n");
  assert.equal(await readWorkspaceFile(cwd, "b.txt"), "beta\n");
  assert.equal(await readWorkspaceFile(cwd, "c.txt"), "existing\n");
  assert.equal(result.isError, true);
  assert.equal(result.terminate, true);
  assert.match(getTextOutput(result), /apply_patch partially failed\./);
  assert.match(getTextOutput(result), /Recovery: MUST read b\.txt before retrying\./);
  const details = result.details;
  assert.ok(details);
  const patchResult = details.result;
  assert.ok(patchResult);
  assert.deepEqual(patchResult.appliedFiles, ["a.txt"]);
  assert.deepEqual(
    patchResult.failures.map((failure) => failure.filePath),
    ["b.txt"],
  );
  assert.deepEqual(patchResult.recoveryInstructions.mustReadFiles, ["b.txt"]);
  assert.deepEqual(patchResult.recoveryInstructions.mustNotReadFiles, ["a.txt"]);
  assert.match(details.diff ?? "", /File: a\.txt/);
  assert.doesNotMatch(details.diff ?? "", /File: b\.txt/);
});

test("apply_patch reports a failed move-with-content-change that already wrote the destination", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src.txt", "alpha\n");

  const sourcePath = join(cwd, "src.txt");
  const destinationPath = join(cwd, "dst.txt");
  const injectedWorkspace = {
    readText: async (absolutePath: string): Promise<string> => readFile(absolutePath, "utf-8"),
    writeText: async (absolutePath: string, content: string): Promise<void> => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
    },
    deleteFile: async (absolutePath: string): Promise<void> => {
      if (absolutePath === sourcePath) {
        throw new Error("simulated source delete failure");
      }
      if (absolutePath === destinationPath) {
        throw new Error("simulated destination rollback failure");
      }
      await unlink(absolutePath);
    },
    renameFile: async (fromPath: string, toPath: string): Promise<void> => {
      await mkdir(dirname(toPath), { recursive: true });
      await rename(fromPath, toPath);
    },
    exists: async (absolutePath: string): Promise<boolean> => {
      try {
        await access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
  };

  const { result } = await runApplyPatch(
    cwd,
    {
      input: `*** Begin Patch
*** Update File: src.txt
*** Move to: dst.txt
@@
-alpha
+beta
*** End Patch`,
    },
    {
      createRealWorkspace: () => injectedWorkspace,
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "src.txt"), "alpha\n");
  assert.equal(await readWorkspaceFile(cwd, "dst.txt"), "beta\n");
  assert.equal(result.isError, true);
  assert.equal(result.terminate, true);
  assert.match(getTextOutput(result), /apply_patch partially failed\./);
  assert.match(getTextOutput(result), /Recovery: MUST read src\.txt, dst\.txt before retrying\./);
  assert.match(
    getTextOutput(result),
    /Some file actions were already applied before this patch failed\./,
  );
  assert.doesNotMatch(getTextOutput(result), /No file actions were applied\./);

  const patchResult = result.details?.result;
  assert.ok(patchResult);
  assert.deepEqual(patchResult.appliedFiles, []);
  assert.equal(patchResult.hasPartialSuccess, true);
  assert.deepEqual(
    patchResult.failures.map((failure) => failure.filePath),
    ["src.txt"],
  );
  assert.deepEqual(patchResult.recoveryInstructions.mustReadFiles, ["src.txt", "dst.txt"]);
  assert.deepEqual(patchResult.recoveryInstructions.mustNotReadFiles, []);
});
