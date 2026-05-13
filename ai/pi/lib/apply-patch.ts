/**
 * Standalone apply_patch engine for the local Pi config.
 *
 * Supports Codex-style patch envelopes with add/delete/update/move operations,
 * previews patch effects before mutation, and serializes file mutations through
 * Pi's file mutation queue.
 */
import {
  access as fsAccess,
  mkdir,
  readFile as fsReadFile,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import process from "node:process";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import * as Diff from "diff";
import { type Static, Type } from "typebox";

export const applyPatchSchema = Type.Object(
  {
    input: Type.String({
      description: "Full Codex-style apply_patch payload (*** Begin Patch ... *** End Patch).",
    }),
  },
  { additionalProperties: false },
);

export type ApplyPatchInput = Static<typeof applyPatchSchema>;
type ApplyPatchOperationKind = "add" | "delete" | "update";

interface UpdateChunk {
  changeContexts: string[];
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

type PatchOperation =
  | { kind: "add"; path: string; contents: string }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; chunks: UpdateChunk[] };

export interface ApplyPatchPreviewFile {
  filePath: string;
  moveTo?: string;
  operation: ApplyPatchOperationKind;
  diff: string;
  added: number;
  removed: number;
}

export interface ApplyPatchPreview {
  files: ApplyPatchPreviewFile[];
  added: number;
  removed: number;
}

export interface ApplyPatchProgress {
  applied: number;
  failed: number;
  total: number;
}

export interface ApplyPatchFailure {
  filePath: string;
  operation: ApplyPatchOperationKind;
  message: string;
  recoveryPaths?: string[];
  wroteFiles?: string[];
}

export interface ApplyPatchRecoveryInstructions {
  mustReadFiles: string[];
  mustNotReadFiles: string[];
}

export interface ApplyPatchResult {
  summaries: string[];
  appliedFiles: string[];
  failures: ApplyPatchFailure[];
  hasPartialSuccess: boolean;
  recoveryInstructions: ApplyPatchRecoveryInstructions;
  details: {
    fuzz: number;
  };
}

export interface ApplyPatchToolDetails {
  diff: string;
  firstChangedLine?: number;
  preview?: ApplyPatchPreview;
  progress?: ApplyPatchProgress;
  result?: ApplyPatchResult;
}

interface ApplyPatchToolResult {
  content: [{ type: "text"; text: string }];
  details: ApplyPatchToolDetails;
  isError?: boolean;
  terminate?: boolean;
}

interface Workspace {
  readText: (absolutePath: string) => Promise<string>;
  writeText: (absolutePath: string, content: string) => Promise<void>;
  deleteFile: (absolutePath: string) => Promise<void>;
  renameFile: (fromPath: string, toPath: string) => Promise<void>;
  exists: (absolutePath: string) => Promise<boolean>;
}

interface SplitText {
  lines: string[];
  hasTrailingNewline: boolean;
}

interface SequenceMatch {
  index: number;
  fuzz: 0 | 1 | 100 | 10000;
}

interface DiffCursor {
  oldLineNumber: number;
  newLineNumber: number;
  firstChangedLine?: number;
  lastWasChange: boolean;
}

interface PatchApplySuccess {
  summary: string;
  appliedFile: string;
  previewFile: ApplyPatchPreviewFile;
  firstChangedLine?: number;
  fuzz: number;
}

interface ApplyPatchExecutionOptions {
  createRealWorkspace?: () => Workspace;
}

interface ApplyPatchPartialWriteErrorOptions {
  recoveryPaths: readonly string[];
  wroteFiles: readonly string[];
  cause?: unknown;
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

interface PreviewState {
  preview: ApplyPatchPreview;
  diff: string;
  firstChangedLine?: number;
  fuzz: number;
}

function normalizePatchText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripHeredoc(input: string): string {
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
  if (heredocMatch?.[2] !== undefined) {
    return heredocMatch[2];
  }
  return input;
}

function trimBoundaryBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start]?.trim() === "") {
    start += 1;
  }

  let end = lines.length;
  while (end > start && lines[end - 1]?.trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end);
}

function stripPathSigil(filePath: string): string {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

function resolvePatchPath(cwd: string, filePath: string): string {
  const trimmed = stripPathSigil(filePath.trim());
  if (trimmed.length === 0) {
    throw new Error("Patch path cannot be empty.");
  }
  return isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(cwd, trimmed);
}

function normalizeSeekLine(line: string): string {
  return line
    .trim()
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
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

function toApplyPatchFailure(operation: PatchOperation, error: unknown): ApplyPatchFailure {
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

function parseUpdateChunk(
  lines: readonly string[],
  startIndex: number,
  lastContentLine: number,
  allowMissingContext: boolean,
): { chunk: UpdateChunk; nextIndex: number } {
  let index = startIndex;
  const changeContexts: string[] = [];
  let consumedHeader = false;

  while (index <= lastContentLine) {
    const header = getArrayValue(lines, index, "Missing update chunk header.").trimEnd();
    if (header === "@@") {
      consumedHeader = true;
      index += 1;
      continue;
    }
    if (header.startsWith("@@ ")) {
      consumedHeader = true;
      changeContexts.push(header.slice(3));
      index += 1;
      continue;
    }
    break;
  }

  if (!consumedHeader && !allowMissingContext) {
    const actual = getArrayValue(lines, startIndex, "Missing update chunk header.").trimEnd();
    throw new Error(`Expected update hunk to start with @@ context marker, got: '${actual}'.`);
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let parsedLineCount = 0;
  let isEndOfFile = false;

  while (index <= lastContentLine) {
    const raw = getArrayValue(lines, index, "Missing patch body line.");
    const trimmed = raw.trimEnd();

    if (trimmed === "*** End of File") {
      if (parsedLineCount === 0) {
        throw new Error("Update hunk does not contain any lines.");
      }
      isEndOfFile = true;
      index += 1;
      break;
    }

    if (parsedLineCount > 0 && (trimmed.startsWith("@@") || trimmed.startsWith("*** "))) {
      break;
    }

    if (raw.length === 0) {
      oldLines.push("");
      newLines.push("");
      parsedLineCount += 1;
      index += 1;
      continue;
    }

    const marker = raw.slice(0, 1);
    const body = raw.slice(1);
    if (marker === " ") {
      oldLines.push(body);
      newLines.push(body);
    } else if (marker === "-") {
      oldLines.push(body);
    } else if (marker === "+") {
      newLines.push(body);
    } else if (parsedLineCount === 0) {
      throw new Error(
        `Unexpected line found in update hunk: '${raw}'. Every line should start with ' ', '+', or '-'.`,
      );
    } else {
      break;
    }

    parsedLineCount += 1;
    index += 1;
  }

  if (parsedLineCount === 0) {
    throw new Error("Update hunk does not contain any lines.");
  }

  return {
    chunk: { changeContexts, oldLines, newLines, isEndOfFile },
    nextIndex: index,
  };
}

function parseAddFileOperation(
  lines: readonly string[],
  startIndex: number,
  lastContentLine: number,
): { operation: PatchOperation; nextIndex: number } {
  const line = getArrayValue(lines, startIndex, "Missing add-file header.").trim();
  const filePath = line.slice("*** Add File: ".length);
  let index = startIndex + 1;
  const contentLines: string[] = [];

  while (index <= lastContentLine) {
    const next = getArrayValue(lines, index, "Missing add-file content line.");
    if (next.trim().startsWith("*** ")) {
      break;
    }
    if (!next.startsWith("+")) {
      throw new Error(`Invalid add-file line '${next}'. Add file lines must start with '+'.`);
    }
    contentLines.push(next.slice(1));
    index += 1;
  }

  return {
    operation: { kind: "add", path: filePath, contents: contentLines.join("\n") },
    nextIndex: index,
  };
}

function parseDeleteFileOperation(line: string): PatchOperation {
  return { kind: "delete", path: line.slice("*** Delete File: ".length) };
}

function skipBlankPatchLines(
  lines: readonly string[],
  startIndex: number,
  lastContentLine: number,
): number {
  let index = startIndex;
  while (
    index <= lastContentLine &&
    getArrayValue(lines, index, "Missing patch body.").trim() === ""
  ) {
    index += 1;
  }
  return index;
}

function parseUpdateFileOperation(
  lines: readonly string[],
  startIndex: number,
  lastContentLine: number,
): { operation: PatchOperation; nextIndex: number } {
  const line = getArrayValue(lines, startIndex, "Missing update-file header.").trim();
  const filePath = line.slice("*** Update File: ".length);
  let index = skipBlankPatchLines(lines, startIndex + 1, lastContentLine);
  let moveTo: string | undefined;

  if (index <= lastContentLine) {
    const maybeMove = getArrayValue(lines, index, "Missing patch move header.").trim();
    if (maybeMove.startsWith("*** Move to: ")) {
      moveTo = maybeMove.slice("*** Move to: ".length);
      index += 1;
    }
  }

  const chunks: UpdateChunk[] = [];
  while (index <= lastContentLine) {
    const chunkHeader = getArrayValue(lines, index, "Missing update chunk header.");
    if (chunkHeader.trim() === "") {
      index += 1;
      continue;
    }
    if (chunkHeader.trim().startsWith("*** ")) {
      break;
    }

    const parsed = parseUpdateChunk(lines, index, lastContentLine, chunks.length === 0);
    chunks.push(parsed.chunk);
    index = parsed.nextIndex;
  }

  if (chunks.length === 0 && moveTo === undefined) {
    throw new Error(`Update file hunk for path '${filePath}' is empty.`);
  }

  return {
    operation:
      moveTo === undefined
        ? { kind: "update", path: filePath, chunks }
        : { kind: "update", path: filePath, moveTo, chunks },
    nextIndex: index,
  };
}

export function parsePatch(patchText: string): PatchOperation[] {
  const lines = trimBoundaryBlankLines(normalizePatchText(stripHeredoc(patchText)).split("\n"));
  if (lines.length < 2) {
    throw new Error("Patch is empty or invalid.");
  }
  if (getArrayValue(lines, 0, "Patch is empty.").trim() !== "*** Begin Patch") {
    throw new Error("The first line of the patch must be '*** Begin Patch'.");
  }
  if (getArrayValue(lines, lines.length - 1, "Patch is empty.").trim() !== "*** End Patch") {
    throw new Error("The last line of the patch must be '*** End Patch'.");
  }

  const operations: PatchOperation[] = [];
  let index = 1;
  const lastContentLine = lines.length - 2;

  while (index <= lastContentLine) {
    const current = getArrayValue(lines, index, "Missing patch header.");
    if (current.trim() === "") {
      index += 1;
      continue;
    }

    const line = current.trim();
    if (line.startsWith("*** Add File: ")) {
      const parsed = parseAddFileOperation(lines, index, lastContentLine);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push(parseDeleteFileOperation(line));
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const parsed = parseUpdateFileOperation(lines, index, lastContentLine);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(
      `'${line}' is not a valid hunk header. Valid headers: '*** Add File:', '*** Delete File:', '*** Update File:'.`,
    );
  }

  return operations;
}

async function writeFileAtomic(absolutePath: string, content: string): Promise<void> {
  const tempPath = `${absolutePath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await fsWriteFile(tempPath, content, "utf-8");
  try {
    await fsRename(tempPath, absolutePath);
  } catch {
    await fsUnlink(absolutePath).catch(() => undefined);
    await fsRename(tempPath, absolutePath);
  }
}

function createRealWorkspace(): Workspace {
  return {
    readText: async (absolutePath: string) => fsReadFile(absolutePath, "utf-8"),
    writeText: async (absolutePath: string, content: string) =>
      writeFileAtomic(absolutePath, content),
    deleteFile: async (absolutePath: string) => fsUnlink(absolutePath),
    renameFile: async (fromPath: string, toPath: string) => {
      await mkdir(dirname(toPath), { recursive: true });
      await fsRename(fromPath, toPath);
    },
    exists: async (absolutePath: string) => {
      try {
        await fsAccess(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createVirtualWorkspace(cwd: string): Workspace {
  const state = new Map<string, string | null>();

  async function ensureLoaded(absolutePath: string): Promise<void> {
    if (state.has(absolutePath)) {
      return;
    }

    try {
      const content = await fsReadFile(absolutePath, "utf-8");
      state.set(absolutePath, content);
    } catch {
      state.set(absolutePath, null);
    }
  }

  return {
    readText: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      const content = state.get(absolutePath);
      if (content === null || content === undefined) {
        throw new Error(`File not found: ${absolutePath.replace(`${cwd}/`, "")}`);
      }
      return content;
    },
    writeText: async (absolutePath: string, content: string) => {
      state.set(absolutePath, content);
    },
    deleteFile: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      if (state.get(absolutePath) === null) {
        throw new Error(`File not found: ${absolutePath.replace(`${cwd}/`, "")}`);
      }
      state.set(absolutePath, null);
    },
    renameFile: async (fromPath: string, toPath: string) => {
      await ensureLoaded(fromPath);
      const content = state.get(fromPath);
      if (content === null || content === undefined) {
        throw new Error(`File not found: ${fromPath.replace(`${cwd}/`, "")}`);
      }
      state.set(toPath, content);
      state.set(fromPath, null);
    },
    exists: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      return state.get(absolutePath) !== null;
    },
  };
}

function appendChangedDiffLines(
  rawLines: readonly string[],
  output: string[],
  lineNumberWidth: number,
  cursor: DiffCursor,
  added: boolean,
): void {
  if (cursor.firstChangedLine === undefined) {
    cursor.firstChangedLine = cursor.newLineNumber;
  }

  for (const line of rawLines) {
    if (added) {
      const lineNumber = String(cursor.newLineNumber).padStart(lineNumberWidth, " ");
      output.push(`+${lineNumber} ${line}`);
      cursor.newLineNumber += 1;
      continue;
    }

    const lineNumber = String(cursor.oldLineNumber).padStart(lineNumberWidth, " ");
    output.push(`-${lineNumber} ${line}`);
    cursor.oldLineNumber += 1;
  }

  cursor.lastWasChange = true;
}

function appendContextDiffLines(
  rawLines: readonly string[],
  output: string[],
  lineNumberWidth: number,
  cursor: DiffCursor,
  contextLines: number,
  nextPartIsChange: boolean,
): void {
  if (!cursor.lastWasChange && !nextPartIsChange) {
    cursor.oldLineNumber += rawLines.length;
    cursor.newLineNumber += rawLines.length;
    return;
  }

  const showAtStart = cursor.lastWasChange ? contextLines : 0;
  const showAtEnd = nextPartIsChange ? contextLines : 0;

  if (rawLines.length <= showAtStart + showAtEnd) {
    for (const line of rawLines) {
      const lineNumber = String(cursor.oldLineNumber).padStart(lineNumberWidth, " ");
      output.push(` ${lineNumber} ${line}`);
      cursor.oldLineNumber += 1;
      cursor.newLineNumber += 1;
    }
    cursor.lastWasChange = false;
    return;
  }

  for (let index = 0; index < showAtStart; index += 1) {
    const lineNumber = String(cursor.oldLineNumber).padStart(lineNumberWidth, " ");
    const line = getArrayValue(rawLines, index, "Missing raw diff line.");
    output.push(` ${lineNumber} ${line}`);
    cursor.oldLineNumber += 1;
    cursor.newLineNumber += 1;
  }

  const skipped = rawLines.length - showAtStart - showAtEnd;
  if (skipped > 0) {
    output.push(` ${"".padStart(lineNumberWidth, " ")} ...`);
    cursor.oldLineNumber += skipped;
    cursor.newLineNumber += skipped;
  }

  for (let index = rawLines.length - showAtEnd; index < rawLines.length; index += 1) {
    const lineNumber = String(cursor.oldLineNumber).padStart(lineNumberWidth, " ");
    const line = getArrayValue(rawLines, index, "Missing raw diff line.");
    output.push(` ${lineNumber} ${line}`);
    cursor.oldLineNumber += 1;
    cursor.newLineNumber += 1;
  }

  cursor.lastWasChange = false;
}

function generateDiffSummary(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): { diff: string; firstChangedLine: number | undefined; added: number; removed: number } {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLineNumber = Math.max(oldLines.length, newLines.length);
  const lineNumberWidth = String(maxLineNumber).length;

  const cursor: DiffCursor = {
    oldLineNumber: 1,
    newLineNumber: 1,
    lastWasChange: false,
  };

  let added = 0;
  let removed = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = getArrayValue(parts, index, "Missing diff part.");
    const rawLines = part.value.split("\n");
    if (rawLines[rawLines.length - 1] === "") {
      rawLines.pop();
    }

    if (part.added || part.removed) {
      if (part.added) {
        added += rawLines.length;
      }
      if (part.removed) {
        removed += rawLines.length;
      }
      appendChangedDiffLines(rawLines, output, lineNumberWidth, cursor, part.added);
      continue;
    }

    const nextPart = index + 1 < parts.length ? parts[index + 1] : undefined;
    const nextPartIsChange = nextPart?.added === true || nextPart?.removed === true;
    appendContextDiffLines(
      rawLines,
      output,
      lineNumberWidth,
      cursor,
      contextLines,
      nextPartIsChange,
    );
  }

  return { diff: output.join("\n"), firstChangedLine: cursor.firstChangedLine, added, removed };
}

function formatPreviewFilePath(file: Pick<ApplyPatchPreviewFile, "filePath" | "moveTo">): string {
  return file.moveTo === undefined ? file.filePath : `${file.filePath} -> ${file.moveTo}`;
}

function buildPreview(files: readonly ApplyPatchPreviewFile[]): ApplyPatchPreview {
  return {
    files: [...files],
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  };
}

function buildCombinedDiff(files: readonly ApplyPatchPreviewFile[]): string {
  return files
    .filter((file) => file.diff.length > 0)
    .map((file) => `File: ${formatPreviewFilePath(file)}\n${file.diff}`)
    .join("\n\n");
}

function buildFirstChangedLine(
  files: readonly { firstChangedLine?: number }[],
): number | undefined {
  return files.find((file) => file.firstChangedLine !== undefined)?.firstChangedLine;
}

function formatPatchPreview(preview: ApplyPatchPreview): string {
  if (preview.files.length === 0) {
    return "(no file operations)";
  }

  return preview.files
    .map((file) => {
      const label =
        file.operation === "add"
          ? "Add"
          : file.operation === "delete"
            ? "Delete"
            : file.moveTo === undefined
              ? "Update"
              : "Move";
      return `- ${label} ${formatPreviewFilePath(file)} (+${file.added} -${file.removed})`;
    })
    .join("\n");
}

function buildPendingMessage(preview: ApplyPatchPreview, progress: ApplyPatchProgress): string {
  return `Applying patch (${progress.applied + progress.failed}/${progress.total})...\n${formatPatchPreview(preview)}`;
}

function getFailureRecoveryPaths(failure: ApplyPatchFailure): string[] {
  return failure.recoveryPaths ?? [failure.filePath];
}

function didFailureWriteFiles(failure: ApplyPatchFailure): boolean {
  return (failure.wroteFiles?.length ?? 0) > 0;
}

function buildRecoveryInstructions(
  result: Pick<ApplyPatchResult, "appliedFiles" | "failures">,
): ApplyPatchRecoveryInstructions {
  const mustReadFiles = [...new Set(result.failures.flatMap(getFailureRecoveryPaths))];
  const mustNotReadFiles = [
    ...new Set(result.appliedFiles.filter((filePath) => !mustReadFiles.includes(filePath))),
  ];
  return { mustReadFiles, mustNotReadFiles };
}

function buildApplyPatchResult(
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

function formatSuccessMessage(result: ApplyPatchResult): string {
  const lines = [`Applied patch with ${result.summaries.length} operation(s).`];
  for (const [index, summary] of result.summaries.entries()) {
    lines.push(`${index + 1}. ${summary}`);
  }
  return lines.join("\n");
}

function formatFailureMessage(result: ApplyPatchResult): string {
  const failedPaths = result.recoveryInstructions.mustReadFiles.join(", ");
  const lines = ["apply_patch partially failed."];

  if (result.summaries.length > 0) {
    lines.push("Applied:");
    for (const [index, summary] of result.summaries.entries()) {
      lines.push(`${index + 1}. ${summary}`);
    }
  }

  lines.push("Failed:");
  for (const failure of result.failures) {
    lines.push(`- ${failure.filePath}: ${failure.message}`);
  }

  if (failedPaths.length > 0) {
    lines.push(`Recovery: MUST read ${failedPaths} before retrying.`);
  }
  lines.push(
    result.hasPartialSuccess
      ? "Some file actions were already applied before this patch failed."
      : "No file actions were applied.",
  );
  if (result.recoveryInstructions.mustNotReadFiles.length > 0) {
    lines.push(
      "Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it.",
    );
  }

  return lines.join("\n");
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

async function applyPatchOperation(
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

async function buildPreviewState(
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

function getTargetPaths(cwd: string, operations: readonly PatchOperation[]): string[] {
  const targetPaths = new Set<string>();
  for (const operation of operations) {
    targetPaths.add(resolvePatchPath(cwd, operation.path));
    if (operation.kind === "update" && operation.moveTo !== undefined) {
      targetPaths.add(resolvePatchPath(cwd, operation.moveTo));
    }
  }
  return [...targetPaths].sort();
}

async function withWorkspaceLocks<T>(
  absolutePaths: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  let run: () => Promise<T> = fn;

  for (let index = absolutePaths.length - 1; index >= 0; index -= 1) {
    const absolutePath = absolutePaths[index];
    if (absolutePath === undefined) {
      continue;
    }

    const nextRun = run;
    run = async (): Promise<T> => withFileMutationQueue(absolutePath, nextRun);
  }

  return run();
}

function buildDetails(
  diff: string,
  preview?: ApplyPatchPreview,
  progress?: ApplyPatchProgress,
  result?: ApplyPatchResult,
  firstChangedLine?: number,
): ApplyPatchToolDetails {
  const details: ApplyPatchToolDetails = { diff };
  if (firstChangedLine !== undefined) {
    details.firstChangedLine = firstChangedLine;
  }
  if (preview !== undefined) {
    details.preview = preview;
  }
  if (progress !== undefined) {
    details.progress = progress;
  }
  if (result !== undefined) {
    details.result = result;
  }
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function prepareApplyPatchArguments(args: unknown): ApplyPatchInput {
  if (typeof args === "string") {
    return { input: args };
  }

  if (isRecord(args)) {
    if (typeof args["input"] === "string") {
      return { input: args["input"] };
    }
    if (typeof args["patch"] === "string") {
      return { input: args["patch"] };
    }
  }

  return { input: "" };
}

export async function executeApplyPatchTool(
  _toolCallId: string,
  params: ApplyPatchInput,
  signal: AbortSignal | undefined,
  onUpdate:
    | ((partialResult: {
        content: [{ type: "text"; text: string }];
        details: ApplyPatchToolDetails;
      }) => void)
    | undefined,
  cwd: string,
  options?: ApplyPatchExecutionOptions,
): Promise<ApplyPatchToolResult> {
  const patchText = normalizePatchText(stripHeredoc(params.input));
  const operations = parsePatch(patchText);
  const targetPaths = getTargetPaths(cwd, operations);

  let preflight: PreviewState;
  try {
    preflight = await buildPreviewState(operations, createVirtualWorkspace(cwd), cwd, signal);
  } catch (error) {
    throw new Error(`Preflight failed before mutating files.\n${getErrorMessage(error)}`, {
      cause: error,
    });
  }

  const initialProgress: ApplyPatchProgress = { applied: 0, failed: 0, total: operations.length };
  onUpdate?.({
    content: [{ type: "text", text: buildPendingMessage(preflight.preview, initialProgress) }],
    details: buildDetails(
      preflight.diff,
      preflight.preview,
      initialProgress,
      undefined,
      preflight.firstChangedLine,
    ),
  });

  return withWorkspaceLocks(targetPaths, async () => {
    let lockedPreflight: PreviewState;
    try {
      lockedPreflight = await buildPreviewState(
        operations,
        createVirtualWorkspace(cwd),
        cwd,
        signal,
      );
    } catch (error) {
      throw new Error(`Preflight failed before mutating files.\n${getErrorMessage(error)}`, {
        cause: error,
      });
    }

    const summaries: string[] = [];
    const appliedFiles: string[] = [];
    const failures: ApplyPatchFailure[] = [];
    const appliedPreviewFiles: ApplyPatchPreviewFile[] = [];
    const appliedChangedLines: Array<{ firstChangedLine?: number }> = [];
    let fuzz = 0;

    const realWorkspace = options?.createRealWorkspace?.() ?? createRealWorkspace();
    await runSequentially(operations, async (operation) => {
      if (isAborted(signal)) {
        throw new Error("Operation aborted.");
      }

      try {
        const success = await applyPatchOperation(operation, realWorkspace, cwd, signal);
        summaries.push(success.summary);
        appliedFiles.push(success.appliedFile);
        appliedPreviewFiles.push(success.previewFile);
        appliedChangedLines.push(
          success.firstChangedLine === undefined
            ? {}
            : { firstChangedLine: success.firstChangedLine },
        );
        fuzz += success.fuzz;
      } catch (error) {
        failures.push(toApplyPatchFailure(operation, error));
      }

      const progress: ApplyPatchProgress = {
        applied: summaries.length,
        failed: failures.length,
        total: operations.length,
      };
      onUpdate?.({
        content: [{ type: "text", text: buildPendingMessage(lockedPreflight.preview, progress) }],
        details: buildDetails(
          lockedPreflight.diff,
          lockedPreflight.preview,
          progress,
          undefined,
          lockedPreflight.firstChangedLine,
        ),
      });
    });

    const result = buildApplyPatchResult(summaries, appliedFiles, failures, fuzz);
    const appliedPreview = buildPreview(appliedPreviewFiles);
    const appliedDiff = buildCombinedDiff(appliedPreviewFiles);
    const appliedFirstChangedLine = buildFirstChangedLine(appliedChangedLines);
    const progress: ApplyPatchProgress = {
      applied: summaries.length,
      failed: failures.length,
      total: operations.length,
    };

    if (failures.length > 0) {
      return {
        content: [{ type: "text", text: formatFailureMessage(result) }],
        details: buildDetails(
          appliedDiff,
          appliedPreview,
          progress,
          result,
          appliedFirstChangedLine,
        ),
        isError: true,
        terminate: true,
      };
    }

    return {
      content: [{ type: "text", text: formatSuccessMessage(result) }],
      details: buildDetails(appliedDiff, appliedPreview, progress, result, appliedFirstChangedLine),
    };
  });
}
