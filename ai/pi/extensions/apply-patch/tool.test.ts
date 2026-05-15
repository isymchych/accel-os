import assert from "node:assert/strict";
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

type ToolUpdate = ToolResult;

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
      const update = normalizeToolResult(partial);
      updates.push(update);
      options?.onUpdate?.(update);
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

test("apply_patch adds, updates, and deletes files without partial UI updates", async (t) => {
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
    "Applied 3 operations.\n1. Added file added.txt.\n2. Updated keep.txt.\n3. Deleted file remove.txt.",
  );
  assert.equal(result.isError, undefined);
  assert.equal(updates.length, 0);

  const details = result.details;
  assert.ok(details);
  assert.equal("progress" in details, false);
  assert.match(details.diff ?? "", /File: added.txt/);
  assert.match(details.diff ?? "", /File: keep.txt/);
  assert.match(details.diff ?? "", /File: remove.txt/);
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
  assert.equal(getTextOutput(result), "Applied 1 operation.\n1. Moved src.txt to moved.txt.");
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
    "Applied 1 operation.\n1. Updated src/app.ts and moved it to src/main.ts.",
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

test("apply_patch resolves @-prefixed paths without creating literal @ files", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: @note.txt
*** Move to: @renamed.txt
@@
-alpha
+beta
*** End Patch`,
  });

  assert.equal(await fileExists(cwd, "note.txt"), false);
  assert.equal(await fileExists(cwd, "@note.txt"), false);
  assert.equal(await fileExists(cwd, "@renamed.txt"), false);
  assert.equal(await readWorkspaceFile(cwd, "renamed.txt"), "beta\n");
});

test("apply_patch uses fuzzy matching and reports non-zero fuzz", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(
    cwd,
    "note.txt",
    `greeting = “hello”\nrange = a–b\nspace = a\u00A0b\ntrail = value   \n`,
  );

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
-greeting = "hello"
+greeting = "hi"
-range = a-b
+range = a-c
-space = a b
+space = a c
-trail = value
+trail = updated
*** End Patch`,
  });

  assert.equal(
    await readWorkspaceFile(cwd, "note.txt"),
    `greeting = "hi"\nrange = a-c\nspace = a c\ntrail = updated\n`,
  );
  assert.ok((result.details?.result?.details.fuzz ?? 0) > 0);
});

test("apply_patch preserves trailing newline state on update", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "no-newline.txt", "alpha");
  await writeWorkspaceFile(cwd, "with-newline.txt", "alpha\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: no-newline.txt
@@
-alpha
+beta
*** Update File: with-newline.txt
@@
-alpha
+beta
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "no-newline.txt"), "beta");
  assert.equal(await readWorkspaceFile(cwd, "with-newline.txt"), "beta\n");
});

test("apply_patch supports add then update in the same patch", async (t) => {
  const cwd = await createTempWorkspace(t);

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Add File: note.txt
+alpha
+beta
*** Update File: note.txt
@@
-alpha
+one
 beta
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "one\nbeta");
  assert.equal(
    getTextOutput(result),
    "Applied 2 operations.\n1. Added file note.txt.\n2. Updated note.txt.",
  );
});

test("apply_patch supports delete then move to the same destination in one patch", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "dst.txt", "stale\n");

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Delete File: dst.txt
*** Update File: src.txt
*** Move to: dst.txt
*** End Patch`,
  });

  assert.equal(await fileExists(cwd, "src.txt"), false);
  assert.equal(await readWorkspaceFile(cwd, "dst.txt"), "alpha\n");
  assert.equal(
    getTextOutput(result),
    "Applied 2 operations.\n1. Deleted file dst.txt.\n2. Moved src.txt to dst.txt.",
  );
});

test("apply_patch applies hunks containing blank lines", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n\nbeta\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
 alpha
-
+middle
 beta
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\nmiddle\nbeta\n");
});

test("apply_patch supports explicit end-of-file insertion hunks", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
 beta
+gamma
*** End of File
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\nbeta\ngamma\n");
});

test("apply_patch reports accurate preview metadata for deep edits", async (t) => {
  const cwd = await createTempWorkspace(t);
  const initialContent = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
  await writeWorkspaceFile(cwd, "note.txt", `${initialContent}\n`);

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
-line 6
+updated 6
*** End Patch`,
  });

  const details = result.details;
  assert.ok(details);
  const previewFile = details.preview?.files[0];
  assert.ok(previewFile);
  assert.equal(details.firstChangedLine, 6);
  assert.equal(previewFile.added, 1);
  assert.equal(previewFile.removed, 1);
  assert.match(details.diff ?? "", / \.+/);
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

test("apply_patch marks partial failure as an error when a later operation fails", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "b.txt", "beta\n");

  let firstWriteApplied = false;
  const injectedWorkspace = {
    readText: async (absolutePath: string): Promise<string> => readFile(absolutePath, "utf-8"),
    writeText: async (absolutePath: string, content: string): Promise<void> => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
      if (absolutePath === join(cwd, "a.txt")) {
        firstWriteApplied = true;
      }
    },
    deleteFile: async (absolutePath: string): Promise<void> => {
      await unlink(absolutePath);
    },
    renameFile: async (fromPath: string, toPath: string): Promise<void> => {
      await mkdir(dirname(toPath), { recursive: true });
      await rename(fromPath, toPath);
    },
    exists: async (absolutePath: string): Promise<boolean> => {
      if (absolutePath === join(cwd, "c.txt") && firstWriteApplied) {
        return true;
      }
      try {
        await access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
  };

  const { result, updates } = await runApplyPatch(
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
      createRealWorkspace: () => injectedWorkspace,
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "a.txt"), "one\n");
  assert.equal(await readWorkspaceFile(cwd, "b.txt"), "beta\n");
  assert.equal(await fileExists(cwd, "c.txt"), false);
  assert.equal(result.isError, true);
  assert.equal(result.terminate, true);
  assert.equal(updates.length, 0);
  assert.match(getTextOutput(result), /apply_patch failed after applying 1 operation\./);
  assert.match(getTextOutput(result), /Recovery: reread b\.txt before retrying\./);

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
  assert.match(getTextOutput(result), /apply_patch failed after partially applying operations\./);
  assert.match(getTextOutput(result), /Recovery: reread src\.txt, dst\.txt before retrying\./);

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
