import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { getTextOutput, normalizeToolResult } from "../../shared/test-helpers.ts";
import { APPLY_PATCH_LARK_GRAMMAR } from "./grammar.ts";
import applyPatchExtension from "./index.ts";
import {
  applyPatchSchema,
  executeApplyPatchTool,
  prepareApplyPatchArguments,
  type ApplyPatchInput,
} from "./tool.ts";
import { WorkspaceMutationError } from "./workspace.ts";

interface ApplyPatchToolDetails extends Record<string, unknown> {
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
      phase?: "preflight";
      operationIndex?: number;
      chunkIndex?: number;
      recoveryPaths?: string[];
      wroteFiles?: string[];
      stateUnknown?: boolean;
    }>;
    hasPartialSuccess: boolean;
    recoveryInstructions: {
      mustReadFiles: string[];
      mustNotReadFiles: string[];
    };
    details: {
      fuzz: number;
      exact: boolean;
    };
  };
}

interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  details?: ApplyPatchToolDetails;
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

async function runApplyPatch(
  cwd: string,
  params: ApplyPatchInput,
  options?: {
    onUpdate?: (partial: ToolUpdate) => void;
    updateFileMode?: "normalize-lf" | "preserve";
    createRealWorkspace?: () => {
      readText: (absolutePath: string) => Promise<string>;
      createText: (absolutePath: string, content: string) => Promise<void>;
      replaceText: (absolutePath: string, content: string) => Promise<void>;
      deleteFile: (absolutePath: string) => Promise<void>;
      renameFile: (fromPath: string, toPath: string) => Promise<void>;
      exists: (absolutePath: string) => Promise<boolean>;
    };
  },
): Promise<{ result: ToolResult; updates: ToolUpdate[] }> {
  const updates: ToolUpdate[] = [];
  const executionOptions =
    options?.createRealWorkspace === undefined && options?.updateFileMode === undefined
      ? undefined
      : {
          ...(options.createRealWorkspace === undefined
            ? {}
            : { createRealWorkspace: options.createRealWorkspace }),
          ...(options.updateFileMode === undefined
            ? {}
            : { updateFileMode: options.updateFileMode }),
        };
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

test("tool schema remains a top-level object for Pi registration", () => {
  assert.equal(applyPatchSchema.type, "object");
});

test("tool exposes OpenAI Lark constrained sampling grammar", () => {
  let registeredTool: unknown;
  const registerTool = (tool: unknown): void => {
    registeredTool = tool;
  };
  const on = (): void => {};

  (
    applyPatchExtension as unknown as (pi: {
      registerTool: typeof registerTool;
      on: typeof on;
    }) => void
  )({ registerTool, on });

  assert.deepEqual((registeredTool as { constrainedSampling?: unknown }).constrainedSampling, {
    type: "grammar",
    variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR },
  });
  assert.deepEqual((registeredTool as { promptGuidelines?: unknown }).promptGuidelines, [
    "Use apply_patch for hunk-based edits, renames, adds, deletes, and context-based updates.",
    "Keep each patch to one cohesive, reviewable batch; prefer at most 3 updated files or 6 update chunks when operations are independent.",
    "After a formatter, generator, or other state-changing command touches target files, reread or inspect those files before constructing another patch.",
    "Pass the full patch text in apply_patch.input.",
    "apply_patch accepts relative or absolute file paths in patch headers.",
    "apply_patch rejects symbolic-link targets, existing add or move destinations, repeated source targets, and move-only updates.",
  ]);
});

test("extension marks structured apply_patch failures as recoverable tool errors", () => {
  let toolResultHandler: ((event: unknown) => unknown) | undefined;
  const registerTool = (): void => {};
  const on = (eventName: string, handler: (event: unknown) => unknown): void => {
    if (eventName === "tool_result") {
      toolResultHandler = handler;
    }
  };

  (
    applyPatchExtension as unknown as (pi: {
      registerTool: typeof registerTool;
      on: typeof on;
    }) => void
  )({ registerTool, on });

  assert.ok(toolResultHandler);
  assert.deepEqual(
    toolResultHandler({
      toolName: "apply_patch",
      details: { result: { failures: [{ message: "failed" }] } },
    }),
    { isError: true },
  );
  assert.equal(
    toolResultHandler({
      toolName: "apply_patch",
      details: { result: { failures: [] } },
    }),
    undefined,
  );
  assert.equal(
    toolResultHandler({
      toolName: "read",
      details: { result: { failures: [{ message: "failed" }] } },
    }),
    undefined,
  );
});

test("apply_patch grammar stays aligned with the Codex-compatible runtime", () => {
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /start: begin_patch/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /add_hunk:/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /delete_hunk:/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /update_hunk:/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /change_move:/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /eof_line:/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /start: begin_patch hunk\+ end_patch/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /add_line\+/);
  assert.match(APPLY_PATCH_LARK_GRAMMAR, /change_move\? change/);
  assert.match(
    APPLY_PATCH_LARK_GRAMMAR,
    /initial_change: change_context\? change_line\+ \(change_context change_line\+\)\*/,
  );
  assert.match(
    APPLY_PATCH_LARK_GRAMMAR,
    /following_change: change_context change_line\+ \(change_context change_line\+\)\*/,
  );
  assert.doesNotMatch(APPLY_PATCH_LARK_GRAMMAR, /change: \(change_context \| change_line\)\+/);
  assert.doesNotMatch(APPLY_PATCH_LARK_GRAMMAR, /separator/);
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

  assert.equal(await readWorkspaceFile(cwd, "added.txt"), "hello\nworld\n");
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

test("apply_patch requires move operations to include a change chunk", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src.txt", "alpha\n");

  await assert.rejects(async () =>
    runApplyPatch(cwd, {
      input: `*** Begin Patch
*** Update File: src.txt
*** Move to: moved.txt
*** End Patch`,
    }),
  );

  assert.equal(await readWorkspaceFile(cwd, "src.txt"), "alpha\n");
  assert.equal(await fileExists(cwd, "moved.txt"), false);
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

test("apply_patch accepts Codex-compatible EOF heredoc input", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  await runApplyPatch(cwd, {
    input: `<<'EOF'
*** Begin Patch
*** Update File: note.txt
@@
-alpha
+beta
*** End Patch
EOF`,
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

test("apply_patch preserves trailing newline state by default", async (t) => {
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

test("apply_patch replaces a read-only file through an atomic rename", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");
  await chmod(join(cwd, "note.txt"), 0o444);

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
-alpha
+beta
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "beta\n");
});

test("apply_patch rejects paths through symbolic-link directories", async (t) => {
  const cwd = await createTempWorkspace(t);
  const outside = await mkdtemp(join(tmpdir(), "pi-apply-patch-outside-"));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(cwd, "linked"));

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Add File: linked/victim.txt
+outside
*** End Patch`,
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.terminate, undefined);
  assert.match(getTextOutput(result), /Refusing to mutate path through symbolic link/);
  assert.equal(await fileExists(outside, "victim.txt"), false);
});

test("apply_patch can normalize updated files to LF with a trailing newline", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\r\nbeta");

  await runApplyPatch(
    cwd,
    {
      input: `*** Begin Patch
*** Update File: note.txt
@@
-alpha
+one
 beta
*** End Patch`,
    },
    { updateFileMode: "normalize-lf" },
  );

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "one\nbeta\n");
});

test("apply_patch preserves CRLF endings and an unterminated final line", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\r\nbeta");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
-alpha
+one
 beta
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "one\r\nbeta");
});

test("apply_patch reports line numbers for malformed consecutive contexts", async (t) => {
  const cwd = await createTempWorkspace(t);
  await assert.rejects(
    async () =>
      runApplyPatch(cwd, {
        input: `*** Begin Patch
*** Update File: note.txt
@@
@@
+line
*** End Patch`,
      }),
    /line 4/,
  );
});

test("apply_patch rejects repeated source targets before mutation", async (t) => {
  const cwd = await createTempWorkspace(t);

  await assert.rejects(
    async () =>
      runApplyPatch(cwd, {
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
      }),
    /Multiple operations target note\.txt/,
  );

  assert.equal(await fileExists(cwd, "note.txt"), false);
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
@@
 alpha
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

test("apply_patch appends insertion-only chunks like Codex", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
+gamma
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\nbeta\ngamma\n");
});

test("apply_patch separates an unterminated final line before an insertion-only chunk", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
+gamma
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\ngamma");
});

test("apply_patch preserves insertion-only chunk order at end of file", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
+one
@@
+two
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\none\ntwo\n");
});

test("apply_patch rejects EOF chunks that rematch consumed lines", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n");

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
-beta
+one
*** End of File
@@
-beta
+two
*** End of File
*** End Patch`,
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.terminate, undefined);
  assert.match(getTextOutput(result), /Failed to find expected lines in note\.txt/);
  assert.equal(await readWorkspaceFile(cwd, "note.txt"), "alpha\nbeta\n");
});

test("apply_patch preserves indented marker-looking context lines", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "before\n*** Update File: other.txt\nafter\n");

  await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: note.txt
@@
 before
 *** Update File: other.txt
-after
+updated
*** End Patch`,
  });

  assert.equal(
    await readWorkspaceFile(cwd, "note.txt"),
    "before\n*** Update File: other.txt\nupdated\n",
  );
});

test("apply_patch rejects empty patches", async (t) => {
  const cwd = await createTempWorkspace(t);
  await assert.rejects(
    async () => runApplyPatch(cwd, { input: "*** Begin Patch\n*** End Patch" }),
    /No files were modified/,
  );
});

test("apply_patch rejects existing add and move destinations", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "existing.txt", "keep\n");
  await writeWorkspaceFile(cwd, "source.txt", "source\n");

  const addResult = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Add File: existing.txt
+replacement
*** End Patch`,
  });
  const moveResult = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: source.txt
*** Move to: existing.txt
@@
 source
*** End Patch`,
  });

  assert.equal(addResult.result.isError, undefined);
  assert.equal(addResult.result.terminate, undefined);
  assert.match(getTextOutput(addResult.result), /file already exists/);
  assert.equal(moveResult.result.isError, undefined);
  assert.equal(moveResult.result.terminate, undefined);
  assert.match(getTextOutput(moveResult.result), /destination existing\.txt already exists/);
  assert.equal(await readWorkspaceFile(cwd, "existing.txt"), "keep\n");
  assert.equal(await readWorkspaceFile(cwd, "source.txt"), "source\n");
});

test(
  "apply_patch rejects symbolic-link targets instead of replacing or following them",
  { skip: process.platform === "win32" },
  async (t) => {
    const cwd = await createTempWorkspace(t);
    await writeWorkspaceFile(cwd, "target.txt", "target\n");
    await symlink(join(cwd, "target.txt"), join(cwd, "link.txt"));

    const { result } = await runApplyPatch(cwd, {
      input: `*** Begin Patch
*** Update File: link.txt
@@
-target
+changed
*** End Patch`,
    });

    assert.equal(result.isError, undefined);
    assert.equal(result.terminate, undefined);
    assert.match(getTextOutput(result), /symbolic link/);
    assert.equal(await readWorkspaceFile(cwd, "target.txt"), "target\n");
  },
);

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

test("apply_patch returns a structured no-mutation result when preflight fails", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "first.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "stale.txt", "current\n");

  const { result } = await runApplyPatch(cwd, {
    input: `*** Begin Patch
*** Update File: first.txt
@@
-alpha
+changed
*** Update File: stale.txt
@@
-missing
+replacement
*** End Patch`,
  });

  assert.equal(await readWorkspaceFile(cwd, "first.txt"), "alpha\n");
  assert.equal(await readWorkspaceFile(cwd, "stale.txt"), "current\n");
  assert.equal(result.isError, undefined);
  assert.equal(result.terminate, undefined);
  assert.match(getTextOutput(result), /apply_patch preflight failed; no files were modified\./);
  assert.match(getTextOutput(result), /stale\.txt \(operation 2, chunk 1\)/);
  assert.match(getTextOutput(result), /Recovery: reread stale\.txt before retrying\./);

  const patchResult = result.details?.result;
  assert.ok(patchResult);
  assert.deepEqual(patchResult.appliedFiles, []);
  assert.deepEqual(patchResult.failures, [
    {
      filePath: "stale.txt",
      operation: "update",
      message: "Failed to find expected lines in stale.txt:\nmissing",
      phase: "preflight",
      operationIndex: 1,
      chunkIndex: 0,
      recoveryPaths: ["stale.txt"],
    },
  ]);
  assert.equal(patchResult.hasPartialSuccess, false);
  assert.deepEqual(patchResult.recoveryInstructions.mustReadFiles, ["stale.txt"]);
});

test("apply_patch returns a recoverable partial failure when a later operation fails", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "alpha\n");
  await writeWorkspaceFile(cwd, "b.txt", "beta\n");

  let firstWriteApplied = false;
  const injectedWorkspace = {
    readText: async (absolutePath: string): Promise<string> => readFile(absolutePath, "utf-8"),
    createText: async (absolutePath: string, content: string): Promise<void> => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
      if (absolutePath === join(cwd, "a.txt")) {
        firstWriteApplied = true;
      }
    },
    replaceText: async (absolutePath: string, content: string): Promise<void> => {
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
@@
 beta
*** Add File: later.txt
+later
*** End Patch`,
    },
    {
      createRealWorkspace: () => injectedWorkspace,
    },
  );

  assert.equal(await readWorkspaceFile(cwd, "a.txt"), "one\n");
  assert.equal(await readWorkspaceFile(cwd, "b.txt"), "beta\n");
  assert.equal(await fileExists(cwd, "c.txt"), false);
  assert.equal(await fileExists(cwd, "later.txt"), false);
  assert.equal(result.isError, undefined);
  assert.equal(result.terminate, undefined);
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
  assert.deepEqual(patchResult.recoveryInstructions.mustNotReadFiles, []);
  assert.equal(patchResult.details.exact, true);
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
    createText: async (absolutePath: string, content: string): Promise<void> => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf-8");
    },
    replaceText: async (absolutePath: string, content: string): Promise<void> => {
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
  assert.equal(result.isError, undefined);
  assert.equal(result.terminate, undefined);
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

test("apply_patch treats a state-unknown move destination write as partial", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src.txt", "alpha\n");

  const destinationPath = join(cwd, "dst.txt");
  const injectedWorkspace = {
    readText: async (absolutePath: string): Promise<string> => readFile(absolutePath, "utf-8"),
    createText: async (absolutePath: string, _content: string): Promise<void> => {
      assert.equal(absolutePath, destinationPath);
      throw new WorkspaceMutationError("simulated uncertain destination write failure", true);
    },
    replaceText: async (absolutePath: string, content: string): Promise<void> => {
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
  assert.equal(await fileExists(cwd, "dst.txt"), false);
  assert.equal(result.isError, undefined);
  assert.equal(result.terminate, undefined);
  assert.match(getTextOutput(result), /apply_patch failed after partially applying operations\./);
  assert.match(getTextOutput(result), /Recovery: reread src\.txt, dst\.txt before retrying\./);

  const patchResult = result.details?.result;
  assert.ok(patchResult);
  assert.equal(patchResult.hasPartialSuccess, true);
  assert.equal(patchResult.details.exact, false);
  assert.deepEqual(patchResult.failures, [
    {
      filePath: "src.txt",
      operation: "update",
      message: "simulated uncertain destination write failure",
      recoveryPaths: ["src.txt", "dst.txt"],
      stateUnknown: true,
    },
  ]);
  assert.deepEqual(patchResult.recoveryInstructions.mustReadFiles, ["src.txt", "dst.txt"]);
});
