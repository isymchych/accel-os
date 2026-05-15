import type {
  ApplyPatchFailure,
  ApplyPatchPreviewFile,
  ApplyPatchResult,
  PatchOperation,
  UpdateChunk,
} from "./model.ts";
import { resolvePatchPath } from "./parser.ts";
import {
  buildCombinedDiff,
  buildFirstChangedLine,
  buildPreview,
  generateDiffSummary,
} from "./preview.ts";
import type { Workspace } from "./workspace.ts";

interface SplitText {
  lines: string[];
  hasTrailingNewline: boolean;
}

interface SequenceMatch {
  index: number;
  fuzz: 0 | 1 | 100 | 10000;
}

interface ApplyPatchPartialWriteErrorOptions {
  recoveryPaths: readonly string[];
  wroteFiles: readonly string[];
  cause?: unknown;
}

interface PatchApplySuccess {
  summary: string;
  appliedFile: string;
  previewFile: ApplyPatchPreviewFile;
  firstChangedLine?: number;
  fuzz: number;
}

export interface PreviewState {
  preview: ReturnType<typeof buildPreview>;
  diff: string;
  firstChangedLine?: number;
  fuzz: number;
}

async function runSequentially<T>(
  items: readonly T[],
  handler: (item: T, index: number) => Promise<void>,
  index = 0,
): Promise<void> {
  if (index >= items.length) {
    return;
  }

  const item = items[index];
  if (item === undefined) {
    return;
  }

  await handler(item, index);
  await runSequentially(items, handler, index + 1);
}

class ApplyPatchPartialWriteError extends Error {
  public readonly recoveryPaths: string[];
  public readonly wroteFiles: string[];

  public constructor(message: string, options: ApplyPatchPartialWriteErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApplyPatchPartialWriteError";
    this.recoveryPaths = [...new Set(options.recoveryPaths)];
    this.wroteFiles = [...new Set(options.wroteFiles)];
  }
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function getArrayValue<T>(items: readonly T[], index: number, message: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function splitText(content: string): SplitText {
  if (content.length === 0) {
    return { lines: [], hasTrailingNewline: false };
  }

  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }

  return {
    lines,
    hasTrailingNewline,
  };
}

function joinSplitText(lines: readonly string[], hasTrailingNewline: boolean): string {
  if (lines.length === 0) {
    return hasTrailingNewline ? "\n" : "";
  }

  const content = lines.join("\n");
  return hasTrailingNewline ? `${content}\n` : content;
}

function normalizeSeekLine(line: string): string {
  return line
    .trim()
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function seekSequence(
  lines: readonly string[],
  pattern: readonly string[],
  start: number,
  endOfFile: boolean,
): SequenceMatch | undefined {
  if (pattern.length === 0) {
    return { index: start, fuzz: 0 };
  }
  if (pattern.length > lines.length) {
    return undefined;
  }

  const searchStart =
    endOfFile && lines.length >= pattern.length ? lines.length - pattern.length : start;
  const searchEnd = lines.length - pattern.length;

  const passes: Array<{
    fuzz: SequenceMatch["fuzz"];
    equal: (left: string, right: string) => boolean;
  }> = [
    { fuzz: 0, equal: (left, right) => left === right },
    { fuzz: 1, equal: (left, right) => left.trimEnd() === right.trimEnd() },
    { fuzz: 100, equal: (left, right) => left.trim() === right.trim() },
    {
      fuzz: 10000,
      equal: (left, right) => normalizeSeekLine(left) === normalizeSeekLine(right),
    },
  ];

  for (const pass of passes) {
    for (let lineIndex = searchStart; lineIndex <= searchEnd; lineIndex += 1) {
      let matches = true;
      for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
        const left = getArrayValue(
          lines,
          lineIndex + patternIndex,
          "Internal error while matching file lines.",
        );
        const right = getArrayValue(
          pattern,
          patternIndex,
          "Internal error while matching patch pattern.",
        );
        if (!pass.equal(left, right)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return { index: lineIndex, fuzz: pass.fuzz };
      }
    }
  }

  return undefined;
}

function applyLineReplacements(
  lines: readonly string[],
  replacements: ReadonlyArray<[number, number, string[]]>,
): string[] {
  const next = [...lines];
  for (const [start, oldLength, newSegment] of [...replacements].sort(
    (left, right) => right[0] - left[0],
  )) {
    next.splice(start, oldLength, ...newSegment);
  }
  return next;
}

function deriveUpdatedContent(
  filePath: string,
  currentContent: string,
  chunks: readonly UpdateChunk[],
): { content: string; fuzz: number } {
  const original = splitText(currentContent);
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;
  let fuzz = 0;

  for (const chunk of chunks) {
    for (const changeContext of chunk.changeContexts) {
      const contextMatch = seekSequence(original.lines, [changeContext], lineIndex, false);
      if (contextMatch === undefined) {
        throw new Error(`Failed to find context '${changeContext}' in ${filePath}.`);
      }
      lineIndex = contextMatch.index + 1;
      fuzz += contextMatch.fuzz;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = chunk.isEndOfFile ? original.lines.length : lineIndex;
      replacements.push([insertionIndex, 0, [...chunk.newLines]]);
      continue;
    }

    let pattern = chunk.oldLines;
    let replacementLines = chunk.newLines;

    let match = seekSequence(original.lines, pattern, lineIndex, chunk.isEndOfFile);
    if (match === undefined && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (replacementLines[replacementLines.length - 1] === "") {
        replacementLines = replacementLines.slice(0, -1);
      }
      match = seekSequence(original.lines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (match === undefined) {
      throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`,
      );
    }

    replacements.push([match.index, pattern.length, [...replacementLines]]);
    lineIndex = match.index + pattern.length;
    fuzz += match.fuzz;
  }

  const nextLines = applyLineReplacements(original.lines, replacements);
  return { content: joinSplitText(nextLines, original.hasTrailingNewline), fuzz };
}

async function applyAddOperation(
  operation: Extract<PatchOperation, { kind: "add" }>,
  workspace: Workspace,
  cwd: string,
): Promise<PatchApplySuccess> {
  const absolutePath = resolvePatchPath(cwd, operation.path);
  if (await workspace.exists(absolutePath)) {
    throw new Error(`Failed to add ${operation.path}: file already exists.`);
  }

  await workspace.writeText(absolutePath, operation.contents);
  const diff = generateDiffSummary("", operation.contents);
  return {
    summary: `Added file ${operation.path}.`,
    appliedFile: operation.path,
    previewFile: {
      filePath: operation.path,
      operation: "add",
      diff: diff.diff,
      added: diff.added,
      removed: diff.removed,
    },
    ...(diff.firstChangedLine === undefined ? {} : { firstChangedLine: diff.firstChangedLine }),
    fuzz: 0,
  };
}

async function applyDeleteOperation(
  operation: Extract<PatchOperation, { kind: "delete" }>,
  workspace: Workspace,
  cwd: string,
): Promise<PatchApplySuccess> {
  const absolutePath = resolvePatchPath(cwd, operation.path);
  if (!(await workspace.exists(absolutePath))) {
    throw new Error(`Failed to delete ${operation.path}: file does not exist.`);
  }

  const currentText = await workspace.readText(absolutePath);
  await workspace.deleteFile(absolutePath);
  const diff = generateDiffSummary(currentText, "");
  return {
    summary: `Deleted file ${operation.path}.`,
    appliedFile: operation.path,
    previewFile: {
      filePath: operation.path,
      operation: "delete",
      diff: diff.diff,
      added: diff.added,
      removed: diff.removed,
    },
    ...(diff.firstChangedLine === undefined ? {} : { firstChangedLine: diff.firstChangedLine }),
    fuzz: 0,
  };
}

async function applyUpdateOperation(
  operation: Extract<PatchOperation, { kind: "update" }>,
  workspace: Workspace,
  cwd: string,
): Promise<PatchApplySuccess> {
  const absolutePath = resolvePatchPath(cwd, operation.path);
  if (!(await workspace.exists(absolutePath))) {
    throw new Error(`Failed to update ${operation.path}: file does not exist.`);
  }

  const currentText = await workspace.readText(absolutePath);
  const updated =
    operation.chunks.length === 0
      ? { content: currentText, fuzz: 0 }
      : deriveUpdatedContent(operation.path, currentText, operation.chunks);
  const nextContent = updated.content;
  const absoluteMovePath =
    operation.moveTo === undefined ? undefined : resolvePatchPath(cwd, operation.moveTo);
  const moveTo = operation.moveTo;

  if (
    absoluteMovePath !== undefined &&
    absoluteMovePath !== absolutePath &&
    (await workspace.exists(absoluteMovePath))
  ) {
    throw new Error(
      `Failed to move ${operation.path}: destination ${operation.moveTo} already exists.`,
    );
  }

  if (absoluteMovePath !== undefined && absoluteMovePath !== absolutePath) {
    if (moveTo === undefined) {
      throw new Error(`Failed to move ${operation.path}: destination path is missing.`);
    }

    if (nextContent === currentText) {
      await workspace.renameFile(absolutePath, absoluteMovePath);
    } else {
      await workspace.writeText(absoluteMovePath, nextContent);
      try {
        await workspace.deleteFile(absolutePath);
      } catch (deleteError) {
        try {
          await workspace.deleteFile(absoluteMovePath);
        } catch (rollbackError) {
          throw new ApplyPatchPartialWriteError(
            `Failed to move ${operation.path}: destination ${moveTo} was written, but deleting ${operation.path} and rolling back ${moveTo} both failed.\nDelete error: ${getErrorMessage(deleteError)}\nRollback error: ${getErrorMessage(rollbackError)}`,
            {
              recoveryPaths: [operation.path, moveTo],
              wroteFiles: [moveTo],
              cause: deleteError,
            },
          );
        }

        throw new Error(
          `Failed to move ${operation.path}: deleting ${operation.path} failed after writing ${moveTo}, and the destination rollback succeeded.\nDelete error: ${getErrorMessage(deleteError)}`,
          { cause: deleteError },
        );
      }
    }
  } else {
    await workspace.writeText(absolutePath, nextContent);
  }

  const diff = generateDiffSummary(currentText, nextContent);
  const summary =
    operation.moveTo === undefined
      ? `Updated ${operation.path}.`
      : nextContent === currentText
        ? `Moved ${operation.path} to ${operation.moveTo}.`
        : `Updated ${operation.path} and moved it to ${operation.moveTo}.`;

  return {
    summary,
    appliedFile: operation.moveTo ?? operation.path,
    previewFile: {
      filePath: operation.path,
      ...(operation.moveTo === undefined ? {} : { moveTo: operation.moveTo }),
      operation: "update",
      diff: diff.diff,
      added: diff.added,
      removed: diff.removed,
    },
    ...(diff.firstChangedLine === undefined ? {} : { firstChangedLine: diff.firstChangedLine }),
    fuzz: updated.fuzz,
  };
}

export async function applyPatchOperation(
  operation: PatchOperation,
  workspace: Workspace,
  cwd: string,
  signal?: AbortSignal,
): Promise<PatchApplySuccess> {
  if (isAborted(signal)) {
    throw new Error("Operation aborted.");
  }

  if (operation.kind === "add") {
    return applyAddOperation(operation, workspace, cwd);
  }

  if (operation.kind === "delete") {
    return applyDeleteOperation(operation, workspace, cwd);
  }

  return applyUpdateOperation(operation, workspace, cwd);
}

export async function buildPreviewState(
  operations: readonly PatchOperation[],
  workspace: Workspace,
  cwd: string,
  signal?: AbortSignal,
): Promise<PreviewState> {
  const applied: PatchApplySuccess[] = [];

  await runSequentially(operations, async (operation) => {
    applied.push(await applyPatchOperation(operation, workspace, cwd, signal));
  });

  const firstChangedLine = buildFirstChangedLine(applied);
  return {
    preview: buildPreview(applied.map((item) => item.previewFile)),
    diff: buildCombinedDiff(applied.map((item) => item.previewFile)),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
    fuzz: applied.reduce((total, item) => total + item.fuzz, 0),
  };
}

export function toApplyPatchFailure(operation: PatchOperation, error: unknown): ApplyPatchFailure {
  if (error instanceof ApplyPatchPartialWriteError) {
    return {
      filePath: operation.path,
      operation: operation.kind,
      message: error.message,
      recoveryPaths: error.recoveryPaths,
      wroteFiles: error.wroteFiles,
    };
  }

  return {
    filePath: operation.path,
    operation: operation.kind,
    message: getErrorMessage(error),
  };
}

function getFailureRecoveryPaths(failure: ApplyPatchFailure): string[] {
  return failure.recoveryPaths ?? [failure.filePath];
}

function didFailureWriteFiles(failure: ApplyPatchFailure): boolean {
  return (failure.wroteFiles?.length ?? 0) > 0;
}

function buildRecoveryInstructions(
  result: Pick<ApplyPatchResult, "appliedFiles" | "failures">,
): ApplyPatchResult["recoveryInstructions"] {
  const mustReadFiles = [...new Set(result.failures.flatMap(getFailureRecoveryPaths))];
  const mustNotReadFiles = [
    ...new Set(result.appliedFiles.filter((filePath) => !mustReadFiles.includes(filePath))),
  ];
  return { mustReadFiles, mustNotReadFiles };
}

export function buildApplyPatchResult(
  summaries: readonly string[],
  appliedFiles: readonly string[],
  failures: readonly ApplyPatchFailure[],
  fuzz: number,
): ApplyPatchResult {
  const result: ApplyPatchResult = {
    summaries: [...summaries],
    appliedFiles: [...appliedFiles],
    failures: [...failures],
    hasPartialSuccess:
      failures.length > 0 &&
      (appliedFiles.length > 0 || failures.some((failure) => didFailureWriteFiles(failure))),
    recoveryInstructions: { mustReadFiles: [], mustNotReadFiles: [] },
    details: { fuzz },
  };
  result.recoveryInstructions = buildRecoveryInstructions(result);
  return result;
}
