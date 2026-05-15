import * as Diff from "diff";

import type { ApplyPatchPreview, ApplyPatchPreviewFile } from "./model.ts";

interface DiffCursor {
  oldLineNumber: number;
  newLineNumber: number;
  firstChangedLine?: number;
  lastWasChange: boolean;
}

export interface DiffSummary {
  diff: string;
  firstChangedLine?: number;
  added: number;
  removed: number;
}

function getArrayValue<T>(items: readonly T[], index: number, message: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
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

export function generateDiffSummary(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): DiffSummary {
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

  return {
    diff: output.join("\n"),
    ...(cursor.firstChangedLine === undefined ? {} : { firstChangedLine: cursor.firstChangedLine }),
    added,
    removed,
  };
}

function formatPreviewFilePath(file: Pick<ApplyPatchPreviewFile, "filePath" | "moveTo">): string {
  return file.moveTo === undefined ? file.filePath : `${file.filePath} -> ${file.moveTo}`;
}

export function buildPreview(files: readonly ApplyPatchPreviewFile[]): ApplyPatchPreview {
  return {
    files: [...files],
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  };
}

export function buildCombinedDiff(files: readonly ApplyPatchPreviewFile[]): string {
  return files
    .filter((file) => file.diff.length > 0)
    .map((file) => `File: ${formatPreviewFilePath(file)}\n${file.diff}`)
    .join("\n\n");
}

export function buildFirstChangedLine(
  files: readonly { firstChangedLine?: number }[],
): number | undefined {
  return files.find((file) => file.firstChangedLine !== undefined)?.firstChangedLine;
}
