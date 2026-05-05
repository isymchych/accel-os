import { constants } from "node:fs";
import {
  access as fsAccess,
  mkdir,
  readFile as fsReadFile,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";

import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import * as Diff from "diff";
import { type Static, Type } from "typebox";

const READ_WRITE_ACCESS_MODE = constants.R_OK + constants.W_OK;

const replaceEditSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
  },
  { additionalProperties: false },
);

const multiEditItemSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description:
          "Path to the file to edit (relative or absolute). Inherits from top-level path if omitted.",
      }),
    ),
    oldText: Type.String({ description: "Exact text to find and replace (must match exactly)." }),
    newText: Type.String({ description: "New text to replace the old text with." }),
  },
  { additionalProperties: false },
);

export const multiEditSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({ description: "Path to the file to edit (relative or absolute)." }),
    ),
    edits: Type.Optional(
      Type.Array(replaceEditSchema, {
        minItems: 1,
        description:
          "One or more targeted replacements in the top-level path. Each edit is matched against the original file, not incrementally.",
      }),
    ),
    oldText: Type.Optional(Type.String({ description: "Legacy single-edit compatibility field." })),
    newText: Type.Optional(Type.String({ description: "Legacy single-edit compatibility field." })),
    multi: Type.Optional(
      Type.Array(multiEditItemSchema, {
        minItems: 1,
        description:
          "Multiple edits to apply across one or more files. Each item has oldText/newText and may set path or inherit the top-level path.",
      }),
    ),
    patch: Type.Optional(
      Type.String({
        description:
          "Codex-style apply_patch payload (*** Begin Patch ... *** End Patch). Mutually exclusive with path/edits/oldText/newText/multi.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type MultiEditInput = Static<typeof multiEditSchema>;
type ReplaceEditInput = Static<typeof replaceEditSchema>;
type MultiEditItemInput = Static<typeof multiEditItemSchema>;

interface ClassicEditItem {
  path: string;
  oldText: string;
  newText: string;
}

interface EditResult {
  path: string;
  success: boolean;
  message: string;
  diff?: string;
  firstChangedLine?: number;
}

interface UpdateChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

type PatchOperation =
  | { kind: "add"; path: string; contents: string }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; chunks: UpdateChunk[] };

interface PatchOpResult {
  path: string;
  message: string;
  diff?: string;
  firstChangedLine?: number;
}

interface Workspace {
  readText: (absolutePath: string) => Promise<string>;
  writeText: (absolutePath: string, content: string) => Promise<void>;
  deleteFile: (absolutePath: string) => Promise<void>;
  exists: (absolutePath: string) => Promise<boolean>;
  checkWriteAccess: (absolutePath: string) => Promise<void>;
}

interface DiffCursor {
  oldLineNumber: number;
  newLineNumber: number;
  firstChangedLine?: number;
  lastWasChange: boolean;
}

interface SplitText {
  lines: string[];
  hasTrailingNewline: boolean;
}

interface PlannedReplacement {
  start: number;
  end: number;
  oldText: string;
  newText: string;
}

interface PlannedFileEdit {
  absolutePath: string;
  originalPath: string;
  originalContent: string;
  updatedContent: string;
  editIndexes: number[];
}

interface MultiEditToolResult {
  content: [{ type: "text"; text: string }];
  details: {
    diff: string;
    firstChangedLine?: number;
  };
}

type NormalizedRequest =
  | { kind: "patch"; patch: string }
  | { kind: "classic"; edits: ClassicEditItem[] };

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

function resolveAbsolutePath(cwd: string, filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw new Error("Path cannot be empty.");
  }
  return isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(cwd, trimmed);
}

function normalizeLineForFuzzyMatch(text: string): string {
  return text
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
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
): number | undefined {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return undefined;
  }

  const searchStart =
    endOfFile && lines.length >= pattern.length ? lines.length - pattern.length : start;
  const searchEnd = lines.length - pattern.length;

  const exactEqual = (left: string, right: string): boolean => left === right;
  const rightTrimEqual = (left: string, right: string): boolean =>
    left.trimEnd() === right.trimEnd();
  const trimEqual = (left: string, right: string): boolean => left.trim() === right.trim();
  const fuzzyEqual = (left: string, right: string): boolean =>
    normalizeLineForFuzzyMatch(left) === normalizeLineForFuzzyMatch(right);

  const passes = [exactEqual, rightTrimEqual, trimEqual, fuzzyEqual];

  for (const equal of passes) {
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
        if (!equal(left, right)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return lineIndex;
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
): string {
  const original = splitText(currentContent);
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext !== undefined) {
      const contextIndex = seekSequence(original.lines, [chunk.changeContext], lineIndex, false);
      if (contextIndex === undefined) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${filePath}.`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      replacements.push([original.lines.length, 0, [...chunk.newLines]]);
      continue;
    }

    let pattern = chunk.oldLines;
    let replacementLines = chunk.newLines;

    let found = seekSequence(original.lines, pattern, lineIndex, chunk.isEndOfFile);
    if (found === undefined && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (replacementLines[replacementLines.length - 1] === "") {
        replacementLines = replacementLines.slice(0, -1);
      }
      found = seekSequence(original.lines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (found === undefined) {
      throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`,
      );
    }

    replacements.push([found, pattern.length, [...replacementLines]]);
    lineIndex = found + pattern.length;
  }

  const nextLines = applyLineReplacements(original.lines, replacements);
  return joinSplitText(nextLines, original.hasTrailingNewline);
}

function parseUpdateChunk(
  lines: readonly string[],
  startIndex: number,
  lastContentLine: number,
  allowMissingContext: boolean,
): { chunk: UpdateChunk; nextIndex: number } {
  let index = startIndex;
  let changeContext: string | undefined;
  const first = getArrayValue(lines, index, "Missing update chunk header.").trimEnd();

  if (first === "@@") {
    index += 1;
  } else if (first.startsWith("@@ ")) {
    changeContext = first.slice(3);
    index += 1;
  } else if (!allowMissingContext) {
    throw new Error(`Expected update hunk to start with @@ context marker, got: '${first}'.`);
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

  const chunk: UpdateChunk = { oldLines, newLines, isEndOfFile };
  if (changeContext !== undefined) {
    chunk.changeContext = changeContext;
  }

  return { chunk, nextIndex: index };
}

function parsePatch(patchText: string): PatchOperation[] {
  const lines = trimBoundaryBlankLines(normalizeToLF(patchText).split("\n"));
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
      const path = line.slice("*** Add File: ".length);
      index += 1;
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
      operations.push({ kind: "add", path, contents: contentLines.join("\n") });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({ kind: "delete", path: line.slice("*** Delete File: ".length) });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length);
      index += 1;

      if (index <= lastContentLine) {
        const maybeMove = getArrayValue(lines, index, "Missing patch move header.").trim();
        if (maybeMove.startsWith("*** Move to: ")) {
          throw new Error("Patch move operations (*** Move to:) are not supported.");
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

      if (chunks.length === 0) {
        throw new Error(`Update file hunk for path '${path}' is empty.`);
      }

      operations.push({ kind: "update", path, chunks });
      continue;
    }

    throw new Error(
      `'${line}' is not a valid hunk header. Valid headers: '*** Add File:', '*** Delete File:', '*** Update File:'.`,
    );
  }

  return operations;
}

function createRealWorkspace(): Workspace {
  return {
    readText: async (absolutePath: string) => fsReadFile(absolutePath, "utf-8"),
    writeText: async (absolutePath: string, content: string) => {
      await mkdir(dirname(absolutePath), { recursive: true });
      await fsWriteFile(absolutePath, content, "utf-8");
    },
    deleteFile: async (absolutePath: string) => fsUnlink(absolutePath),
    exists: async (absolutePath: string) => {
      try {
        await fsAccess(absolutePath, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    checkWriteAccess: async (absolutePath: string) =>
      fsAccess(absolutePath, READ_WRITE_ACCESS_MODE),
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
    exists: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      return state.get(absolutePath) !== null;
    },
    checkWriteAccess: async () => Promise.resolve(),
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

function generateDiffString(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
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

  for (let index = 0; index < parts.length; index += 1) {
    const part = getArrayValue(parts, index, "Missing diff part.");
    const rawLines = part.value.split("\n");
    if (rawLines[rawLines.length - 1] === "") {
      rawLines.pop();
    }

    if (part.added || part.removed) {
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

  return { diff: output.join("\n"), firstChangedLine: cursor.firstChangedLine };
}

function formatResults(results: readonly EditResult[], totalEdits: number): string {
  const lines: string[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = getArrayValue(results, index, "Missing edit result.");
    const status = result.success ? "✓" : "✗";
    lines.push(`${status} Edit ${index + 1}/${totalEdits} (${result.path}): ${result.message}`);
  }

  const remaining = totalEdits - results.length;
  if (remaining > 0) {
    lines.push(`⊘ ${remaining} remaining edit(s) skipped due to error.`);
  }

  return lines.join("\n");
}

function findUniqueMatchPositions(content: string, oldText: string): number[] {
  const positions: number[] = [];
  let searchStart = 0;

  while (searchStart <= content.length) {
    const position = content.indexOf(oldText, searchStart);
    if (position === -1) {
      break;
    }
    positions.push(position);
    searchStart = position + 1;
  }

  return positions;
}

function planFileEdit(
  originalPath: string,
  absolutePath: string,
  originalContent: string,
  group: ReadonlyArray<{ index: number; edit: ClassicEditItem }>,
): PlannedFileEdit {
  const replacements: Array<PlannedReplacement & { index: number }> = [];

  for (const entry of group) {
    if (entry.edit.oldText.length === 0) {
      throw new Error(`Could not edit ${entry.edit.path}: oldText must not be empty.`);
    }

    const matches = findUniqueMatchPositions(originalContent, entry.edit.oldText);
    if (matches.length === 0) {
      throw new Error(
        `Could not find the exact text in ${entry.edit.path}. The old text must match exactly once in the original file including all whitespace and newlines.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Could not edit ${entry.edit.path}: oldText must be unique in the original file, but it matched ${matches.length} times.`,
      );
    }

    const start = matches[0];
    if (start === undefined) {
      throw new Error(`Internal error while planning edit for ${entry.edit.path}.`);
    }

    replacements.push({
      index: entry.index,
      start,
      end: start + entry.edit.oldText.length,
      oldText: entry.edit.oldText,
      newText: entry.edit.newText,
    });
  }

  replacements.sort(
    (left, right) => left.start - right.start || left.end - right.end || left.index - right.index,
  );

  for (let index = 1; index < replacements.length; index += 1) {
    const previous = getArrayValue(replacements, index - 1, "Missing previous replacement.");
    const current = getArrayValue(replacements, index, "Missing replacement.");
    if (current.start < previous.end) {
      throw new Error(
        `Could not edit ${originalPath}: requested replacements overlap in the original file.`,
      );
    }
  }

  let updatedContent = originalContent;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    updatedContent =
      updatedContent.slice(0, replacement.start) +
      replacement.newText +
      updatedContent.slice(replacement.end);
  }

  return {
    absolutePath,
    originalPath,
    originalContent,
    updatedContent,
    editIndexes: replacements.map((replacement) => replacement.index),
  };
}

async function applyPatchOperations(
  operations: readonly PatchOperation[],
  workspace: Workspace,
  cwd: string,
  signal?: AbortSignal,
  options?: { collectDiff?: boolean },
): Promise<PatchOpResult[]> {
  const results: PatchOpResult[] = [];
  const collectDiff = options?.collectDiff === true;

  await runSequentially(operations, async (operation) => {
    if (isAborted(signal)) {
      throw new Error("Operation aborted.");
    }

    if (operation.kind === "add") {
      const absolutePath = resolveAbsolutePath(cwd, operation.path);
      let oldText = "";
      if (collectDiff) {
        const alreadyExists = await workspace.exists(absolutePath);
        if (alreadyExists) {
          oldText = await workspace.readText(absolutePath);
        }
      }

      const newText = operation.contents;
      await workspace.writeText(absolutePath, newText);

      const result: PatchOpResult = {
        path: operation.path,
        message: `Added file ${operation.path}.`,
      };
      if (collectDiff) {
        const diff = generateDiffString(oldText, newText);
        result.diff = diff.diff;
        if (diff.firstChangedLine !== undefined) {
          result.firstChangedLine = diff.firstChangedLine;
        }
      }
      results.push(result);
      return;
    }

    if (operation.kind === "delete") {
      const absolutePath = resolveAbsolutePath(cwd, operation.path);
      const exists = await workspace.exists(absolutePath);
      if (!exists) {
        throw new Error(`Failed to delete ${operation.path}: file does not exist.`);
      }

      let oldText = "";
      if (collectDiff) {
        oldText = await workspace.readText(absolutePath);
      }
      await workspace.deleteFile(absolutePath);

      const result: PatchOpResult = {
        path: operation.path,
        message: `Deleted file ${operation.path}.`,
      };
      if (collectDiff) {
        const diff = generateDiffString(oldText, "");
        result.diff = diff.diff;
        if (diff.firstChangedLine !== undefined) {
          result.firstChangedLine = diff.firstChangedLine;
        }
      }
      results.push(result);
      return;
    }

    const absolutePath = resolveAbsolutePath(cwd, operation.path);
    const currentText = await workspace.readText(absolutePath);
    const updatedText = deriveUpdatedContent(operation.path, currentText, operation.chunks);
    await workspace.writeText(absolutePath, updatedText);

    const result: PatchOpResult = { path: operation.path, message: `Updated ${operation.path}.` };
    if (collectDiff) {
      const diff = generateDiffString(currentText, updatedText);
      result.diff = diff.diff;
      if (diff.firstChangedLine !== undefined) {
        result.firstChangedLine = diff.firstChangedLine;
      }
    }
    results.push(result);
  });

  return results;
}

async function planClassicEdits(
  edits: readonly ClassicEditItem[],
  workspace: Workspace,
  cwd: string,
  signal?: AbortSignal,
): Promise<PlannedFileEdit[]> {
  const fileGroups = new Map<string, Array<{ index: number; edit: ClassicEditItem }>>();
  const fileOrder: string[] = [];

  for (const [index, edit] of edits.entries()) {
    const absolutePath = resolveAbsolutePath(cwd, edit.path);
    const existingGroup = fileGroups.get(absolutePath);
    if (existingGroup === undefined) {
      fileGroups.set(absolutePath, [{ index, edit }]);
      fileOrder.push(absolutePath);
      continue;
    }

    existingGroup.push({ index, edit });
  }

  await Promise.all(
    fileOrder.map(async (absolutePath) => workspace.checkWriteAccess(absolutePath)),
  );

  const planned: PlannedFileEdit[] = [];
  await runSequentially(fileOrder, async (absolutePath) => {
    if (isAborted(signal)) {
      throw new Error("Operation aborted.");
    }

    const group = fileGroups.get(absolutePath);
    if (group === undefined) {
      return;
    }

    const originalContent = await workspace.readText(absolutePath);
    const originalPath = getArrayValue(group, 0, "Missing edit group entry.").edit.path;
    planned.push(planFileEdit(originalPath, absolutePath, originalContent, group));
  });

  return planned;
}

async function applyPlannedClassicEdits(
  edits: readonly ClassicEditItem[],
  plannedFiles: readonly PlannedFileEdit[],
  workspace: Workspace,
  signal?: AbortSignal,
  options?: { collectDiff?: boolean },
): Promise<EditResult[]> {
  const collectDiff = options?.collectDiff === true;
  const results: Array<EditResult | undefined> = new Array<EditResult | undefined>(edits.length);

  await runSequentially(plannedFiles, async (plannedFile) => {
    if (isAborted(signal)) {
      throw new Error("Operation aborted.");
    }

    await workspace.writeText(plannedFile.absolutePath, plannedFile.updatedContent);

    for (const editIndex of plannedFile.editIndexes) {
      const edit = getArrayValue(edits, editIndex, "Missing edit item.");
      results[editIndex] = {
        path: edit.path,
        success: true,
        message: `Edited ${edit.path}.`,
      };
    }

    if (!collectDiff || plannedFile.editIndexes.length === 0) {
      return;
    }

    const diff = generateDiffString(plannedFile.originalContent, plannedFile.updatedContent);
    const firstEditIndex = getArrayValue(plannedFile.editIndexes, 0, "Missing planned edit index.");
    const firstResult = results[firstEditIndex];
    if (firstResult !== undefined) {
      firstResult.diff = diff.diff;
      if (diff.firstChangedLine !== undefined) {
        firstResult.firstChangedLine = diff.firstChangedLine;
      }
    }
  });

  return results.filter((value): value is EditResult => value !== undefined);
}

function getPatchTargetPaths(cwd: string, operations: readonly PatchOperation[]): string[] {
  return [
    ...new Set(operations.map((operation) => resolveAbsolutePath(cwd, operation.path))),
  ].sort();
}

function getClassicTargetPaths(cwd: string, edits: readonly ClassicEditItem[]): string[] {
  return [...new Set(edits.map((edit) => resolveAbsolutePath(cwd, edit.path)))].sort();
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
  firstChangedLine?: number,
): { diff: string; firstChangedLine?: number } {
  const details: { diff: string; firstChangedLine?: number } = { diff };
  if (firstChangedLine !== undefined) {
    details.firstChangedLine = firstChangedLine;
  }
  return details;
}

function hasOwnProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  return value;
}

function readReplaceEditArray(record: Record<string, unknown>): ReplaceEditInput[] | undefined {
  const value = record["edits"];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Top-level edits[] must contain at least one edit.");
  }

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item["oldText"] !== "string" ||
      typeof item["newText"] !== "string"
    ) {
      throw new Error("Each edits[] item must include string oldText and newText fields.");
    }

    return {
      oldText: item["oldText"],
      newText: item["newText"],
    };
  });
}

function readMultiEditArray(record: Record<string, unknown>): MultiEditItemInput[] | undefined {
  const value = record["multi"];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("multi must contain at least one edit.");
  }

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item["oldText"] !== "string" ||
      typeof item["newText"] !== "string"
    ) {
      throw new Error("Each multi item must include string oldText and newText fields.");
    }

    const path = item["path"];
    if (path !== undefined && typeof path !== "string") {
      throw new Error("multi item path must be a string when provided.");
    }

    return {
      ...(path === undefined ? {} : { path }),
      oldText: item["oldText"],
      newText: item["newText"],
    };
  });
}

function normalizeMultiEditInput(params: MultiEditInput): NormalizedRequest {
  const rawParams: Record<string, unknown> = params;
  const hasPatch = hasOwnProperty(rawParams, "patch");
  const hasEdits = hasOwnProperty(rawParams, "edits");
  const hasMulti = hasOwnProperty(rawParams, "multi");
  const hasOldText = hasOwnProperty(rawParams, "oldText");
  const hasNewText = hasOwnProperty(rawParams, "newText");

  const activeModes = [hasPatch, hasEdits, hasMulti, hasOldText || hasNewText].filter(
    Boolean,
  ).length;
  if (activeModes === 0) {
    throw new Error(
      "No edits provided. Supply path+edits[], path+oldText/newText, multi, or patch.",
    );
  }
  if (activeModes > 1) {
    throw new Error(
      "Edit input must use exactly one mode: path+edits[], path+oldText/newText, multi, or patch.",
    );
  }

  const path = readOptionalString(rawParams, "path");
  const patch = readOptionalString(rawParams, "patch");
  const oldText = readOptionalString(rawParams, "oldText");
  const newText = readOptionalString(rawParams, "newText");

  if (hasPatch) {
    if (patch === undefined) {
      throw new Error("patch must be a string.");
    }
    return { kind: "patch", patch };
  }

  const edits = readReplaceEditArray(rawParams);
  if (hasEdits) {
    if (path === undefined) {
      throw new Error("Top-level edits[] requires a top-level path.");
    }
    if (edits === undefined) {
      throw new Error("Top-level edits[] must contain at least one edit.");
    }
    return {
      kind: "classic",
      edits: edits.map((edit) => ({ path, oldText: edit.oldText, newText: edit.newText })),
    };
  }

  if (hasOldText || hasNewText) {
    if (oldText === undefined || newText === undefined) {
      throw new Error("Incomplete legacy top-level edit: provide both oldText and newText.");
    }
    if (path === undefined) {
      throw new Error("Top-level oldText/newText requires a top-level path.");
    }
    return {
      kind: "classic",
      edits: [{ path, oldText, newText }],
    };
  }

  const multi = readMultiEditArray(rawParams);
  if (multi === undefined) {
    throw new Error("multi must contain at least one edit.");
  }

  return {
    kind: "classic",
    edits: multi.map((item) => {
      const itemPath = item.path ?? path;
      if (itemPath === undefined || itemPath.trim().length === 0) {
        throw new Error(
          "A multi edit item is missing path. Set item.path or provide a top-level path to inherit.",
        );
      }
      return {
        path: itemPath,
        oldText: item.oldText,
        newText: item.newText,
      };
    }),
  };
}

export async function executeMultiEditTool(
  _toolCallId: string,
  params: MultiEditInput,
  signal: AbortSignal | undefined,
  _onUpdate: unknown,
  cwd: string,
): Promise<MultiEditToolResult> {
  const request = normalizeMultiEditInput(params);

  if (request.kind === "patch") {
    const operations = parsePatch(request.patch);
    const targetPaths = getPatchTargetPaths(cwd, operations);

    await applyPatchOperations(operations, createVirtualWorkspace(cwd), cwd, signal, {
      collectDiff: false,
    });

    return withWorkspaceLocks(targetPaths, async () => {
      await applyPatchOperations(operations, createVirtualWorkspace(cwd), cwd, signal, {
        collectDiff: false,
      });
      const applied = await applyPatchOperations(operations, createRealWorkspace(), cwd, signal, {
        collectDiff: true,
      });
      const summary = applied.map((result, index) => `${index + 1}. ${result.message}`).join("\n");
      const combinedDiff = applied
        .filter((result) => result.diff !== undefined && result.diff.length > 0)
        .map((result) => `File: ${result.path}\n${result.diff ?? ""}`)
        .join("\n\n");
      const firstChangedLine = applied.find(
        (result) => result.firstChangedLine !== undefined,
      )?.firstChangedLine;

      return {
        content: [
          { type: "text", text: `Applied patch with ${applied.length} operation(s).\n${summary}` },
        ],
        details: buildDetails(combinedDiff, firstChangedLine),
      };
    });
  }

  const targetPaths = getClassicTargetPaths(cwd, request.edits);

  try {
    await planClassicEdits(request.edits, createVirtualWorkspace(cwd), cwd, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Preflight failed before mutating files.\n${message}`, { cause: error });
  }

  return withWorkspaceLocks(targetPaths, async () => {
    let planned: PlannedFileEdit[];
    try {
      planned = await planClassicEdits(request.edits, createVirtualWorkspace(cwd), cwd, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Preflight failed before mutating files.\n${message}`, { cause: error });
    }

    const results = await applyPlannedClassicEdits(
      request.edits,
      planned,
      createRealWorkspace(),
      signal,
      {
        collectDiff: true,
      },
    );
    if (results.length === 1) {
      const result = getArrayValue(results, 0, "Missing edit result.");
      return {
        content: [{ type: "text", text: result.message }],
        details: buildDetails(result.diff ?? "", result.firstChangedLine),
      };
    }

    const combinedDiff = results
      .filter((result) => result.diff !== undefined && result.diff.length > 0)
      .map((result) => `File: ${result.path}\n${result.diff ?? ""}`)
      .join("\n\n");
    const firstChangedLine = results.find(
      (result) => result.firstChangedLine !== undefined,
    )?.firstChangedLine;
    const summary = results.map((result, index) => `${index + 1}. ${result.message}`).join("\n");

    return {
      content: [
        { type: "text", text: `Applied ${results.length} edit(s) successfully.\n${summary}` },
      ],
      details: buildDetails(combinedDiff, firstChangedLine),
    };
  });
}

export { formatResults, parsePatch, deriveUpdatedContent };
