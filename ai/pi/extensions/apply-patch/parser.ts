import { isAbsolute, resolve as resolvePath } from "node:path";

import type { PatchOperation, UpdateChunk } from "./model.ts";

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const END_OF_FILE_MARKER = "*** End of File";

export class PatchParseError extends Error {
  public readonly lineNumber: number | undefined;

  public constructor(message: string, lineNumber?: number) {
    super(
      lineNumber === undefined ? message : `Invalid patch hunk on line ${lineNumber}: ${message}`,
    );
    this.name = "PatchParseError";
    this.lineNumber = lineNumber;
  }
}

export function normalizePatchText(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

export function stripHeredoc(input: string): string {
  const lines = normalizePatchText(input).trim().split("\n");
  if (
    lines.length >= 4 &&
    (lines[0] === "<<EOF" || lines[0] === "<<'EOF'" || lines[0] === '<<"EOF"') &&
    lines.at(-1) === "EOF"
  ) {
    return lines.slice(1, -1).join("\n");
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

export function resolvePatchPath(cwd: string, filePath: string): string {
  const trimmed = stripPathSigil(filePath.trim());
  if (trimmed.length === 0) {
    throw new Error("Patch path cannot be empty.");
  }
  return isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(cwd, trimmed);
}

function invalidHunk(message: string, lineIndex: number): PatchParseError {
  return new PatchParseError(message, lineIndex + 1);
}

function parseHeaderPath(line: string, marker: string, lineIndex: number): string {
  const path = line.slice(marker.length);
  if (path.length === 0) {
    throw invalidHunk(`Path after '${marker.trimEnd()}' cannot be empty`, lineIndex);
  }
  return path;
}

function isTopLevelMarker(line: string): boolean {
  return (
    line === END_PATCH_MARKER ||
    line.startsWith(ADD_FILE_MARKER) ||
    line.startsWith(DELETE_FILE_MARKER) ||
    line.startsWith(UPDATE_FILE_MARKER)
  );
}

function createChunk(changeContext?: string): UpdateChunk {
  return {
    ...(changeContext === undefined ? {} : { changeContext }),
    oldLines: [],
    newLines: [],
    contextLineIndices: [],
    isEndOfFile: false,
  };
}

function chunkIsEmpty(chunk: UpdateChunk): boolean {
  return chunk.oldLines.length === 0 && chunk.newLines.length === 0;
}

function pushContextLine(chunk: UpdateChunk, line: string): void {
  chunk.contextLineIndices.push([chunk.oldLines.length, chunk.newLines.length]);
  chunk.oldLines.push(line);
  chunk.newLines.push(line);
}

function ensureLastChunkHasLines(
  chunks: readonly UpdateChunk[],
  line: string,
  lineIndex: number,
): void {
  const chunk = chunks.at(-1);
  if (chunk === undefined || !chunkIsEmpty(chunk)) {
    return;
  }

  throw invalidHunk(
    line === END_PATCH_MARKER
      ? "Update hunk does not contain any lines"
      : `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
    lineIndex,
  );
}

function parseAddFile(
  lines: readonly string[],
  startIndex: number,
  endIndex: number,
): { operation: PatchOperation; nextIndex: number } {
  const header = lines[startIndex]?.trim();
  if (header === undefined) {
    throw invalidHunk("Missing add-file header", startIndex);
  }
  const path = parseHeaderPath(header, ADD_FILE_MARKER, startIndex);
  const contentLines: string[] = [];
  let index = startIndex + 1;

  while (index < endIndex) {
    const raw = lines[index];
    if (raw === undefined) {
      break;
    }
    if (isTopLevelMarker(raw.trim())) {
      break;
    }
    if (!raw.startsWith("+")) {
      throw invalidHunk(`'${raw.trim()}' is not a valid hunk header or add-file line`, index);
    }
    contentLines.push(raw.slice(1));
    index += 1;
  }

  if (contentLines.length === 0) {
    throw invalidHunk(`Add file hunk for path '${path}' does not contain any lines`, startIndex);
  }

  return {
    operation: { kind: "add", path, contents: `${contentLines.join("\n")}\n` },
    nextIndex: index,
  };
}

interface UpdateParserState {
  chunks: UpdateChunk[];
  moveTo: string | undefined;
  afterEndOfFile: boolean;
}

function isChangeContextMarker(line: string): boolean {
  return line === "@@" || line.startsWith("@@ ");
}

function appendUpdateBodyLine(state: UpdateParserState, raw: string, lineIndex: number): void {
  let chunk = state.chunks.at(-1);
  if (chunk === undefined) {
    chunk = createChunk();
    state.chunks.push(chunk);
  }

  if (raw === "") {
    pushContextLine(chunk, "");
    return;
  }
  if (raw.startsWith(" ")) {
    pushContextLine(chunk, raw.slice(1));
    return;
  }
  if (raw.startsWith("+")) {
    chunk.newLines.push(raw.slice(1));
    return;
  }
  if (raw.startsWith("-")) {
    chunk.oldLines.push(raw.slice(1));
    return;
  }

  throw invalidHunk(
    chunkIsEmpty(chunk)
      ? `Unexpected line found in update hunk: '${raw}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`
      : `Expected update hunk to start with a @@ context marker, got: '${raw}'`,
    lineIndex,
  );
}

function processUpdateLine(state: UpdateParserState, raw: string, lineIndex: number): void {
  const updateLine = raw.trimEnd();

  if (state.afterEndOfFile) {
    if (updateLine === "") {
      return;
    }
    if (!isChangeContextMarker(updateLine)) {
      throw invalidHunk(
        `Expected update hunk to start with a @@ context marker, got: '${raw}'`,
        lineIndex,
      );
    }
    state.afterEndOfFile = false;
  }

  if (
    state.chunks.length === 0 &&
    state.moveTo === undefined &&
    updateLine.startsWith(MOVE_TO_MARKER)
  ) {
    state.moveTo = parseHeaderPath(updateLine, MOVE_TO_MARKER, lineIndex);
    return;
  }

  if (isChangeContextMarker(updateLine)) {
    ensureLastChunkHasLines(state.chunks, updateLine, lineIndex);
    state.chunks.push(createChunk(updateLine === "@@" ? undefined : updateLine.slice(3)));
    return;
  }

  if (updateLine === END_OF_FILE_MARKER) {
    ensureLastChunkHasLines(state.chunks, updateLine, lineIndex);
    const chunk = state.chunks.at(-1);
    if (chunk === undefined) {
      throw invalidHunk("Update hunk does not contain any lines", lineIndex);
    }
    chunk.isEndOfFile = true;
    state.afterEndOfFile = true;
    return;
  }

  appendUpdateBodyLine(state, raw, lineIndex);
}

function parseUpdateFile(
  lines: readonly string[],
  startIndex: number,
  endIndex: number,
): { operation: PatchOperation; nextIndex: number } {
  const header = lines[startIndex]?.trim();
  if (header === undefined) {
    throw invalidHunk("Missing update-file header", startIndex);
  }
  const path = parseHeaderPath(header, UPDATE_FILE_MARKER, startIndex);
  const state: UpdateParserState = {
    chunks: [],
    moveTo: undefined,
    afterEndOfFile: false,
  };
  let index = startIndex + 1;

  while (index < endIndex) {
    const raw = lines[index];
    if (raw === undefined) {
      break;
    }
    const updateLine = raw.trimEnd();

    if (isTopLevelMarker(updateLine)) {
      ensureLastChunkHasLines(state.chunks, updateLine, index);
      break;
    }

    processUpdateLine(state, raw, index);
    index += 1;
  }

  ensureLastChunkHasLines(state.chunks, END_PATCH_MARKER, Math.min(index, endIndex));
  if (state.chunks.length === 0) {
    throw invalidHunk(`Update file hunk for path '${path}' is empty`, startIndex);
  }

  return {
    operation:
      state.moveTo === undefined
        ? { kind: "update", path, chunks: state.chunks }
        : { kind: "update", path, moveTo: state.moveTo, chunks: state.chunks },
    nextIndex: index,
  };
}

export function parsePatch(patchText: string): PatchOperation[] {
  const lines = trimBoundaryBlankLines(normalizePatchText(stripHeredoc(patchText)).split("\n"));
  if (lines[0]?.trim() !== BEGIN_PATCH_MARKER) {
    throw new PatchParseError("The first line of the patch must be '*** Begin Patch'");
  }
  if (lines.at(-1)?.trim() !== END_PATCH_MARKER) {
    throw new PatchParseError("The last line of the patch must be '*** End Patch'");
  }

  const operations: PatchOperation[] = [];
  const endIndex = lines.length - 1;
  let index = 1;

  while (index < endIndex) {
    const raw = lines[index];
    if (raw === undefined) {
      break;
    }
    const line = raw.trim();

    if (line.startsWith(ADD_FILE_MARKER)) {
      const parsed = parseAddFile(lines, index, endIndex);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }
    if (line.startsWith(DELETE_FILE_MARKER)) {
      const path = parseHeaderPath(line, DELETE_FILE_MARKER, index);
      operations.push({ kind: "delete", path });
      index += 1;
      continue;
    }
    if (line.startsWith(UPDATE_FILE_MARKER)) {
      const parsed = parseUpdateFile(lines, index, endIndex);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    throw invalidHunk(
      `'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
      index,
    );
  }

  return operations;
}
