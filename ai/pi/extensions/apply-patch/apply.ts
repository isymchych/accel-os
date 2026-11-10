import type {
  ApplyPatchFailure,
  ApplyPatchPreviewFile,
  ApplyPatchFileUpdateMode,
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
import { WorkspaceMutationError } from "./workspace.ts";

type LineEnding = "\n" | "\r\n" | "\r";

interface SourceLine {
  text: string;
  ending?: LineEnding;
}

interface SourceText {
  lines: SourceLine[];
  preferredEnding: LineEnding;
  hasTrailingNewline: boolean;
}

interface SequenceMatch {
  index: number;
  fuzz: 0 | 1 | 100 | 10000;
}

class PatchChunkApplyError extends Error {
  public readonly chunkIndex: number;

  public constructor(chunkIndex: number, message: string) {
    super(message);
    this.name = "PatchChunkApplyError";
    this.chunkIndex = chunkIndex;
  }
}

export class PatchOperationApplyError extends Error {
  public readonly operationIndex: number;
  public readonly chunkIndex: number | undefined;

  public constructor(operationIndex: number, cause: unknown) {
    super(getErrorMessage(cause), { cause });
    this.name = "PatchOperationApplyError";
    this.operationIndex = operationIndex;
    this.chunkIndex = cause instanceof PatchChunkApplyError ? cause.chunkIndex : undefined;
  }
}

interface ApplyPatchPartialWriteErrorOptions {
  recoveryPaths: readonly string[];
  wroteFiles: readonly string[];
  stateUnknown: boolean;
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
  public readonly stateUnknown: boolean;

  public constructor(message: string, options: ApplyPatchPartialWriteErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApplyPatchPartialWriteError";
    this.recoveryPaths = [...new Set(options.recoveryPaths)];
    this.wroteFiles = [...new Set(options.wroteFiles)];
    this.stateUnknown = options.stateUnknown;
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

function isStateUnknown(error: unknown): boolean {
  return error instanceof WorkspaceMutationError && error.stateUnknown;
}

function parseSourceText(content: string): SourceText {
  const lines: SourceLine[] = [];
  let preferredEnding: LineEnding | undefined;
  let lineStart = 0;
  let cursor = 0;

  while (cursor < content.length) {
    let ending: LineEnding | undefined;
    let endingLength = 0;
    if (content[cursor] === "\r" && content[cursor + 1] === "\n") {
      ending = "\r\n";
      endingLength = 2;
    } else if (content[cursor] === "\r") {
      ending = "\r";
      endingLength = 1;
    } else if (content[cursor] === "\n") {
      ending = "\n";
      endingLength = 1;
    }

    if (ending === undefined) {
      cursor += 1;
      continue;
    }

    preferredEnding ??= ending;
    lines.push({ text: content.slice(lineStart, cursor), ending });
    cursor += endingLength;
    lineStart = cursor;
  }

  if (lineStart < content.length) {
    lines.push({ text: content.slice(lineStart) });
  }

  return {
    lines,
    preferredEnding: preferredEnding ?? "\n",
    hasTrailingNewline: lines.at(-1)?.ending !== undefined,
  };
}

function joinSourceLines(lines: readonly SourceLine[]): string {
  return lines.map((line) => `${line.text}${line.ending ?? ""}`).join("");
}

function normalizeLinesToLf(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function normalizeSeekLine(line: string): string {
  return line
    .trim()
    .replace(/[‐‑‒–—―−]/gu, "-")
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, " ");
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

  const searchStart = endOfFile ? Math.max(start, lines.length - pattern.length) : start;
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

interface LineReplacement {
  start: number;
  oldLength: number;
  newSegment: string[];
  order: number;
}

function applyLineReplacements<T>(
  lines: readonly T[],
  replacements: readonly LineReplacement[],
  makeLine: (line: string) => T,
): T[] {
  const next = [...lines];
  for (const replacement of [...replacements].sort(
    (left, right) => right.start - left.start || right.order - left.order,
  )) {
    next.splice(replacement.start, replacement.oldLength, ...replacement.newSegment.map(makeLine));
  }
  return next;
}

function appendPreservingReplacements(
  replacements: LineReplacement[],
  chunk: UpdateChunk,
  matchIndex: number,
  pattern: readonly string[],
  replacementLines: readonly string[],
  nextOrder: () => number,
): void {
  let oldStart = 0;
  let newStart = 0;

  for (const [oldContext, newContext] of chunk.contextLineIndices) {
    if (oldContext >= pattern.length || newContext >= replacementLines.length) {
      break;
    }
    if (oldStart !== oldContext || newStart !== newContext) {
      replacements.push({
        start: matchIndex + oldStart,
        oldLength: oldContext - oldStart,
        newSegment: replacementLines.slice(newStart, newContext),
        order: nextOrder(),
      });
    }
    oldStart = oldContext + 1;
    newStart = newContext + 1;
  }

  if (oldStart !== pattern.length || newStart !== replacementLines.length) {
    replacements.push({
      start: matchIndex + oldStart,
      oldLength: pattern.length - oldStart,
      newSegment: replacementLines.slice(newStart),
      order: nextOrder(),
    });
  }
}

function deriveUpdatedContent(
  filePath: string,
  currentContent: string,
  chunks: readonly UpdateChunk[],
  updateFileMode: ApplyPatchFileUpdateMode,
): { content: string; fuzz: number } {
  const original = parseSourceText(currentContent);
  const originalLines = original.lines.map((line) => line.text);
  const replacements: LineReplacement[] = [];
  let lineIndex = 0;
  let fuzz = 0;
  let replacementOrder = 0;
  const nextReplacementOrder = (): number => {
    const order = replacementOrder;
    replacementOrder += 1;
    return order;
  };

  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunk.changeContext !== undefined) {
      const contextMatch = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (contextMatch === undefined) {
        throw new PatchChunkApplyError(
          chunkIndex,
          `Failed to find context '${chunk.changeContext}' in ${filePath}.`,
        );
      }
      lineIndex = contextMatch.index + 1;
      fuzz += contextMatch.fuzz;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = originalLines.length;
      replacements.push({
        start: insertionIndex,
        oldLength: 0,
        newSegment: [...chunk.newLines],
        order: nextReplacementOrder(),
      });
      continue;
    }

    let pattern = chunk.oldLines;
    let replacementLines = chunk.newLines;

    let match = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    if (match === undefined && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (replacementLines[replacementLines.length - 1] === "") {
        replacementLines = replacementLines.slice(0, -1);
      }
      match = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (match === undefined) {
      throw new PatchChunkApplyError(
        chunkIndex,
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`,
      );
    }

    if (updateFileMode === "preserve") {
      appendPreservingReplacements(
        replacements,
        chunk,
        match.index,
        pattern,
        replacementLines,
        nextReplacementOrder,
      );
    } else {
      replacements.push({
        start: match.index,
        oldLength: pattern.length,
        newSegment: [...replacementLines],
        order: nextReplacementOrder(),
      });
    }
    lineIndex = match.index + pattern.length;
    fuzz += match.fuzz;
  }

  if (updateFileMode === "normalize-lf") {
    const nextLines = applyLineReplacements(originalLines, replacements, (line) => line);
    return { content: normalizeLinesToLf(nextLines), fuzz };
  }

  const nextLines = applyLineReplacements(original.lines, replacements, (text) => ({
    text,
    ending: original.preferredEnding,
  }));
  for (const line of nextLines.slice(0, -1)) {
    line.ending ??= original.preferredEnding;
  }
  const finalLine = nextLines.at(-1);
  if (finalLine !== undefined) {
    if (original.hasTrailingNewline) {
      finalLine.ending ??= original.preferredEnding;
    } else {
      delete finalLine.ending;
    }
  }
  return { content: joinSourceLines(nextLines), fuzz };
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

  await workspace.createText(absolutePath, operation.contents);
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
  updateFileMode: ApplyPatchFileUpdateMode,
): Promise<PatchApplySuccess> {
  const absolutePath = resolvePatchPath(cwd, operation.path);
  if (!(await workspace.exists(absolutePath))) {
    throw new Error(`Failed to update ${operation.path}: file does not exist.`);
  }

  const currentText = await workspace.readText(absolutePath);
  const updated =
    operation.chunks.length === 0
      ? { content: currentText, fuzz: 0 }
      : deriveUpdatedContent(operation.path, currentText, operation.chunks, updateFileMode);
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
      await workspace.createText(absoluteMovePath, nextContent);
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
              stateUnknown: true,
              cause: deleteError,
            },
          );
        }

        throw new WorkspaceMutationError(
          `Failed to move ${operation.path}: deleting ${operation.path} failed after writing ${moveTo}, and the destination rollback succeeded.\nDelete error: ${getErrorMessage(deleteError)}`,
          isStateUnknown(deleteError),
          deleteError,
        );
      }
    }
  } else {
    await workspace.replaceText(absolutePath, nextContent);
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
  updateFileMode: ApplyPatchFileUpdateMode,
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

  return applyUpdateOperation(operation, workspace, cwd, updateFileMode);
}

export async function buildPreviewState(
  operations: readonly PatchOperation[],
  workspace: Workspace,
  cwd: string,
  updateFileMode: ApplyPatchFileUpdateMode,
  signal?: AbortSignal,
): Promise<PreviewState> {
  const applied: PatchApplySuccess[] = [];

  await runSequentially(operations, async (operation, operationIndex) => {
    try {
      applied.push(await applyPatchOperation(operation, workspace, cwd, updateFileMode, signal));
    } catch (error) {
      throw new PatchOperationApplyError(operationIndex, error);
    }
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
      ...(error.stateUnknown ? { stateUnknown: true } : {}),
    };
  }

  const stateUnknown = error instanceof WorkspaceMutationError && error.stateUnknown;
  return {
    filePath: operation.path,
    operation: operation.kind,
    message: getErrorMessage(error),
    ...(stateUnknown
      ? {
          recoveryPaths:
            operation.kind === "update" && operation.moveTo !== undefined
              ? [operation.path, operation.moveTo]
              : [operation.path],
          stateUnknown: true,
        }
      : {}),
  };
}

function getFailureRecoveryPaths(failure: ApplyPatchFailure): string[] {
  return failure.recoveryPaths ?? [failure.filePath];
}

function didFailureWriteFiles(failure: ApplyPatchFailure): boolean {
  return failure.stateUnknown === true || (failure.wroteFiles?.length ?? 0) > 0;
}

function buildRecoveryInstructions(
  result: Pick<ApplyPatchResult, "appliedFiles" | "failures">,
): ApplyPatchResult["recoveryInstructions"] {
  const mustReadFiles = [...new Set(result.failures.flatMap(getFailureRecoveryPaths))];
  return { mustReadFiles, mustNotReadFiles: [] };
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
    details: {
      fuzz,
      exact: !failures.some((failure) => failure.stateUnknown === true),
    },
  };
  result.recoveryInstructions = buildRecoveryInstructions(result);
  return result;
}
