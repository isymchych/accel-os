import { isAbsolute, resolve as resolvePath } from "node:path";

import type { PatchOperation, UpdateChunk } from "./model.ts";

function getArrayValue<T>(items: readonly T[], index: number, message: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

export function normalizePatchText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function stripHeredoc(input: string): string {
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

export function resolvePatchPath(cwd: string, filePath: string): string {
  const trimmed = stripPathSigil(filePath.trim());
  if (trimmed.length === 0) {
    throw new Error("Patch path cannot be empty.");
  }
  return isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(cwd, trimmed);
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
