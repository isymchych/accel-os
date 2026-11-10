import { createReadStream, existsSync } from "node:fs";
import { lstat, open, readlink, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";

import type { AgentToolResult, ReadToolDetails } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

import type { ReadTargetInput, ReadToolInput } from "./schema.ts";

const narrowNoBreakSpace = "\u202F";
const unicodeSpaces = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu;
const defaultRecursiveDepth = 4;
const maxDirectoryEntries = 2000;
const fileReadChunkBytes = 64 * 1024;

export type ReadTargetKind = "file" | "directory" | "image" | "error";

export interface ReadTargetDetails {
  path: string;
  kind: ReadTargetKind;
  lineCount?: number;
  entryCount?: number;
  truncated?: boolean;
  error?: string;
}

export interface EnhancedReadDetails {
  targets: ReadTargetDetails[];
  directoryEntryLimitReached?: boolean;
}

export type BuiltInRead = (
  target: ReadTargetInput,
  signal: AbortSignal | undefined,
) => Promise<AgentToolResult<ReadToolDetails | undefined>>;

interface OutputBudget {
  maxLines: number;
  maxBytes: number;
}

interface DirectoryBudget {
  remaining: number;
  limitReached: boolean;
}

interface DirectoryTargetBudget {
  maxLines: number;
  maxBytes: number;
  usedBytes: number;
  limitReached: boolean;
}

interface DirectoryListing {
  lines: string[];
  targetLimitReached: boolean;
  globalLimitReached: boolean;
}

interface TargetOutput {
  text: string;
  details: ReadTargetDetails;
  images: AgentToolResult<unknown>["content"];
}

type MoreLinesReason = "budget" | "limit";

interface CollectedTextFile {
  lines: string[];
  startLine: number;
  moreLinesReason?: MoreLinesReason;
  oversizedFirstLineBytes?: number;
  oversizedFirstLineExact?: boolean;
  emptyFile: boolean;
}

interface RenderedTextFile {
  text: string;
  displayedLineCount: number;
  truncated: boolean;
}

interface TextCollectionState {
  selectedLines: string[];
  selectedBytes: number;
  currentLine: number;
  currentLineBytes: number;
  currentStoredBytes: number;
  currentParts: Buffer[];
  stopped: boolean;
  moreLinesReason?: MoreLinesReason;
  oversizedFirstLineBytes?: number;
  oversizedFirstLineExact?: boolean;
  endedWithNewline: boolean;
  totalLines: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Operation aborted");
  }
}

function normalizeAtPrefix(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function expandPath(path: string): string {
  const normalized = normalizeAtPrefix(path.replace(unicodeSpaces, " "));
  if (normalized === "~") {
    return homedir();
  }
  if (normalized.startsWith("~/")) {
    return `${homedir()}${normalized.slice(1)}`;
  }
  return normalized;
}

function resolveReadPath(path: string, cwd: string): string {
  const expanded = expandPath(path);
  const resolved = isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
  if (existsSync(resolved)) {
    return resolved;
  }

  const variants = [
    resolved.replace(/ (AM|PM)\./giu, `${narrowNoBreakSpace}$1.`),
    resolved.normalize("NFD"),
    resolved.replace(/'/gu, "\u2019"),
    resolved.normalize("NFD").replace(/'/gu, "\u2019"),
  ];
  return variants.find((candidate) => candidate !== resolved && existsSync(candidate)) ?? resolved;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function formatDirectoryEntry(kind: string, size: string, path: string): string {
  return `${kind.padEnd(9)} ${size.padStart(8)}  ${path}`;
}

function countOutputLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let lines = 1;
  for (const character of text) {
    if (character === "\n") {
      lines += 1;
    }
  }
  return lines;
}

function fitsBudget(text: string, budget: OutputBudget): boolean {
  return (
    countOutputLines(text) <= budget.maxLines && Buffer.byteLength(text, "utf-8") <= budget.maxBytes
  );
}

function truncateToBudget(
  text: string,
  budget: OutputBudget,
): { text: string; truncated: boolean } {
  const truncation = truncateHead(text, {
    maxLines: Math.max(1, budget.maxLines),
    maxBytes: Math.max(1, budget.maxBytes),
  });
  if (!truncation.firstLineExceedsLimit) {
    return { text: truncation.content, truncated: truncation.truncated };
  }

  const suffix = " [truncated]";
  const suffixBytes = Buffer.byteLength(suffix, "utf-8");
  const maxPrefixBytes = Math.max(0, budget.maxBytes - suffixBytes);
  let prefix = "";
  let prefixBytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf-8");
    if (prefixBytes + characterBytes > maxPrefixBytes) {
      break;
    }
    prefix += character;
    prefixBytes += characterBytes;
  }
  return {
    text: `${prefix}${suffix}`,
    truncated: true,
  };
}

function allocateTargetBudget(
  remaining: OutputBudget,
  remainingTargets: number,
  separator: string,
): OutputBudget {
  const separatorLines = separator.length === 0 ? 0 : 2;
  const separatorBytes = Buffer.byteLength(separator, "utf-8");
  remaining.maxLines = Math.max(0, remaining.maxLines - separatorLines);
  remaining.maxBytes = Math.max(0, remaining.maxBytes - separatorBytes);
  return {
    maxLines: Math.max(1, Math.floor(remaining.maxLines / remainingTargets)),
    maxBytes: Math.max(1, Math.floor(remaining.maxBytes / remainingTargets)),
  };
}

async function describeDirectoryEntry(
  absolutePath: string,
  relativePath: string,
): Promise<{ line: string; isDirectory: boolean }> {
  const entryStat = await lstat(absolutePath);
  const displayPath = toPosixPath(relativePath);

  if (entryStat.isSymbolicLink()) {
    const target = await readlink(absolutePath);
    return {
      line: formatDirectoryEntry("symlink", "-", `${displayPath} -> ${target}`),
      isDirectory: false,
    };
  }
  if (entryStat.isDirectory()) {
    return {
      line: formatDirectoryEntry("directory", "-", `${displayPath}/`),
      isDirectory: true,
    };
  }
  if (entryStat.isFile()) {
    return {
      line: formatDirectoryEntry("file", formatSize(entryStat.size), displayPath),
      isDirectory: false,
    };
  }
  return {
    line: formatDirectoryEntry("other", "-", displayPath),
    isDirectory: false,
  };
}

function appendDirectoryLine(
  lines: string[],
  line: string,
  budget: DirectoryTargetBudget,
): boolean {
  const separatorBytes = lines.length === 0 ? 0 : 1;
  const lineBytes = Buffer.byteLength(line, "utf-8");
  if (
    lines.length >= budget.maxLines ||
    budget.usedBytes + separatorBytes + lineBytes > budget.maxBytes
  ) {
    budget.limitReached = true;
    return false;
  }
  lines.push(line);
  budget.usedBytes += separatorBytes + lineBytes;
  return true;
}

async function collectDirectoryLines(
  rootPath: string,
  currentPath: string,
  currentDepth: number,
  maxDepth: number,
  globalBudget: DirectoryBudget,
  targetBudget: DirectoryTargetBudget,
  lines: string[],
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (globalBudget.remaining === 0) {
    globalBudget.limitReached = true;
    return;
  }
  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });

  for (const entry of entries) {
    throwIfAborted(signal);
    if (globalBudget.remaining === 0) {
      globalBudget.limitReached = true;
      return;
    }
    if (targetBudget.limitReached) {
      return;
    }

    const absolutePath = join(currentPath, entry.name);
    const relativePath = relative(rootPath, absolutePath);
    try {
      const description = await describeDirectoryEntry(absolutePath, relativePath);
      if (!appendDirectoryLine(lines, description.line, targetBudget)) {
        return;
      }
      globalBudget.remaining -= 1;

      if (description.isDirectory && currentDepth < maxDepth) {
        await collectDirectoryLines(
          rootPath,
          absolutePath,
          currentDepth + 1,
          maxDepth,
          globalBudget,
          targetBudget,
          lines,
          signal,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !appendDirectoryLine(
          lines,
          formatDirectoryEntry("error", "-", `${toPosixPath(relativePath)}: ${message}`),
          targetBudget,
        )
      ) {
        return;
      }
      globalBudget.remaining -= 1;
    }
  }
}

async function listDirectory(
  absolutePath: string,
  recursive: boolean,
  maxDepth: number,
  globalBudget: DirectoryBudget,
  budget: OutputBudget,
  header: string,
  signal: AbortSignal | undefined,
): Promise<DirectoryListing> {
  const lines: string[] = [];
  const headerBytes = Buffer.byteLength(`${header}\n`, "utf-8");
  const targetLimit: DirectoryTargetBudget = {
    maxLines: Math.max(0, budget.maxLines - 1),
    maxBytes: Math.max(0, budget.maxBytes - headerBytes),
    usedBytes: 0,
    limitReached: false,
  };
  await collectDirectoryLines(
    absolutePath,
    absolutePath,
    1,
    recursive ? maxDepth : 1,
    globalBudget,
    targetLimit,
    lines,
    signal,
  );
  return {
    lines,
    targetLimitReached: targetLimit.limitReached,
    globalLimitReached: globalBudget.limitReached,
  };
}

function renderDirectory(
  header: string,
  listing: DirectoryListing,
  budget: OutputBudget,
): { text: string; entryCount: number; truncated: boolean } {
  const lines = [...listing.lines];
  const truncated = listing.targetLimitReached || listing.globalLimitReached;
  if (!truncated) {
    return {
      text: `${header}\n${lines.join("\n")}`,
      entryCount: lines.length,
      truncated: false,
    };
  }

  const suffix = listing.globalLimitReached
    ? `[Directory entry limit reached: ${maxDirectoryEntries} entries across this read call. Use a smaller max_depth or read a narrower subdirectory.]`
    : "[Directory output truncated for a fair per-target share. Use a smaller max_depth or read a narrower subdirectory.]";
  while (lines.length > 0) {
    const candidate = `${header}\n${lines.join("\n")}\n\n${suffix}`;
    if (fitsBudget(candidate, budget)) {
      return { text: candidate, entryCount: lines.length, truncated: true };
    }
    lines.pop();
  }

  const fallback = truncateToBudget(`${header}\n${suffix}`, budget);
  return { text: fallback.text, entryCount: 0, truncated: true };
}

function getTextContent(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function startsWithBytes(buffer: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Buffer, offset: number, value: string): boolean {
  return (
    buffer.length >= offset + value.length &&
    Array.from(value).every(
      (character, index) => buffer[offset + index] === character.charCodeAt(0),
    )
  );
}

function mightBeSupportedImage(buffer: Buffer): boolean {
  return (
    startsWithBytes(buffer, [0xff, 0xd8, 0xff]) ||
    startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    startsWithAscii(buffer, 0, "GIF") ||
    (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) ||
    startsWithAscii(buffer, 0, "BM")
  );
}

async function readFilePrefix(
  absolutePath: string,
  byteCount: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  throwIfAborted(signal);
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    throwIfAborted(signal);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function createTextCollectionState(): TextCollectionState {
  return {
    selectedLines: [],
    selectedBytes: 0,
    currentLine: 1,
    currentLineBytes: 0,
    currentStoredBytes: 0,
    currentParts: [],
    stopped: false,
    endedWithNewline: false,
    totalLines: 0,
  };
}

function resetCurrentTextLine(state: TextCollectionState): void {
  state.currentLineBytes = 0;
  state.currentStoredBytes = 0;
  state.currentParts = [];
}

function stopBeforeCollectingTextLine(
  state: TextCollectionState,
  startLine: number,
  requestedLines: number,
  maxLines: number,
): boolean {
  if (state.currentLine < startLine) {
    return false;
  }
  if (state.selectedLines.length >= requestedLines) {
    state.moreLinesReason = "limit";
    state.stopped = true;
    return true;
  }
  if (state.selectedLines.length >= maxLines) {
    state.moreLinesReason = "budget";
    state.stopped = true;
    return true;
  }
  return false;
}

function finalizeTextLine(
  state: TextCollectionState,
  startLine: number,
  requestedLines: number,
  maxLines: number,
  maxBytes: number,
): void {
  state.totalLines = state.currentLine;
  if (state.currentLine < startLine) {
    state.currentLine += 1;
    resetCurrentTextLine(state);
    return;
  }
  if (stopBeforeCollectingTextLine(state, startLine, requestedLines, maxLines)) {
    return;
  }
  if (state.selectedBytes + state.currentLineBytes > maxBytes) {
    if (state.selectedLines.length === 0) {
      state.oversizedFirstLineBytes = state.currentLineBytes;
    } else {
      state.moreLinesReason = "budget";
    }
    state.stopped = true;
    return;
  }

  const lineBuffer = Buffer.concat(state.currentParts, state.currentLineBytes);
  state.selectedLines.push(lineBuffer.toString("utf-8"));
  state.selectedBytes += state.currentLineBytes;
  state.currentLine += 1;
  resetCurrentTextLine(state);
}

function stopForOversizedPartialTextLine(
  state: TextCollectionState,
  startLine: number,
  maxBytes: number,
  hasNewline: boolean,
): boolean {
  if (
    state.currentLine < startLine ||
    hasNewline ||
    state.selectedBytes + state.currentLineBytes <= maxBytes
  ) {
    return false;
  }
  if (state.selectedLines.length === 0) {
    state.oversizedFirstLineBytes = state.currentLineBytes;
    state.oversizedFirstLineExact = false;
  } else {
    state.moreLinesReason = "budget";
  }
  state.stopped = true;
  return true;
}

function storeTextSegment(
  state: TextCollectionState,
  segment: Uint8Array,
  startLine: number,
  maxBytes: number,
): void {
  if (state.currentLine < startLine) {
    return;
  }
  const remainingStorage = Math.max(0, maxBytes - state.selectedBytes - state.currentStoredBytes);
  if (remainingStorage === 0) {
    return;
  }
  const stored = Buffer.from(segment.subarray(0, remainingStorage));
  state.currentParts.push(stored);
  state.currentStoredBytes += stored.length;
}

function collectTextChunk(
  state: TextCollectionState,
  chunk: Uint8Array,
  startLine: number,
  requestedLines: number,
  maxLines: number,
  maxBytes: number,
): void {
  let start = 0;
  while (start < chunk.length) {
    const newline = chunk.indexOf(0x0a, start);
    const end = newline === -1 ? chunk.length : newline;
    const segment = chunk.subarray(start, end);
    state.currentLineBytes += segment.length;

    if (stopBeforeCollectingTextLine(state, startLine, requestedLines, maxLines)) {
      return;
    }
    if (stopForOversizedPartialTextLine(state, startLine, maxBytes, newline !== -1)) {
      return;
    }

    storeTextSegment(state, segment, startLine, maxBytes);
    if (newline === -1) {
      state.endedWithNewline = false;
      return;
    }
    state.endedWithNewline = true;
    finalizeTextLine(state, startLine, requestedLines, maxLines, maxBytes);
    if (state.stopped) {
      return;
    }
    start = newline + 1;
  }
}

async function collectTextFile(
  absolutePath: string,
  fileSize: number,
  target: ReadTargetInput,
  maxLines: number,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<CollectedTextFile> {
  const startLine = target.offset ?? 1;
  if (fileSize === 0) {
    if (startLine > 1) {
      throw new Error(`Offset ${target.offset} is beyond end of file (1 lines total)`);
    }
    return { lines: [], startLine, emptyFile: true };
  }

  const requestedLines = target.limit ?? Number.POSITIVE_INFINITY;
  const state = createTextCollectionState();

  const stream = createReadStream(absolutePath, {
    highWaterMark: fileReadChunkBytes,
    ...(signal === undefined ? {} : { signal }),
  });

  try {
    for await (const value of stream) {
      throwIfAborted(signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      collectTextChunk(state, chunk, startLine, requestedLines, maxLines, maxBytes);
      if (state.stopped) {
        stream.destroy();
        break;
      }
    }
  } catch (error: unknown) {
    throwIfAborted(signal);
    throw error;
  }

  if (!state.stopped && (state.currentLineBytes > 0 || state.endedWithNewline)) {
    finalizeTextLine(state, startLine, requestedLines, maxLines, maxBytes);
  }

  if (
    state.selectedLines.length === 0 &&
    state.oversizedFirstLineBytes === undefined &&
    startLine > state.totalLines
  ) {
    throw new Error(
      `Offset ${target.offset} is beyond end of file (${state.totalLines} lines total)`,
    );
  }

  return {
    lines: state.selectedLines,
    startLine,
    ...(state.moreLinesReason === undefined ? {} : { moreLinesReason: state.moreLinesReason }),
    ...(state.oversizedFirstLineBytes === undefined
      ? {}
      : { oversizedFirstLineBytes: state.oversizedFirstLineBytes }),
    ...(state.oversizedFirstLineExact === undefined
      ? {}
      : { oversizedFirstLineExact: state.oversizedFirstLineExact }),
    emptyFile: false,
  };
}

function renderTextFile(
  header: string,
  absolutePath: string,
  collected: CollectedTextFile,
  showLineNumbers: boolean,
  budget: OutputBudget,
): RenderedTextFile {
  if (collected.emptyFile) {
    return { text: `${header}\n`, displayedLineCount: 0, truncated: false };
  }

  if (collected.oversizedFirstLineBytes !== undefined) {
    const limitDescription =
      budget.maxBytes === DEFAULT_MAX_BYTES
        ? `${formatSize(budget.maxBytes)} limit`
        : `${formatSize(budget.maxBytes)} per-target output budget`;
    const lineSize =
      (collected.oversizedFirstLineExact === false ? "at least " : "") +
      formatSize(collected.oversizedFirstLineBytes);
    const message =
      `[Line ${collected.startLine} is ${lineSize}, exceeds ` +
      `${limitDescription}. Use bash: nl -ba -- ` +
      `${quoteForPosixShell(absolutePath)} | sed -n '${collected.startLine}p' | head -c ` +
      `${DEFAULT_MAX_BYTES}]`;
    const fitted = truncateToBudget(`${header}\n${message}`, budget);
    return { text: fitted.text, displayedLineCount: 0, truncated: true };
  }

  const width = String(collected.startLine + Math.max(0, collected.lines.length - 1)).length;
  const renderedLines = showLineNumbers
    ? collected.lines.map(
        (line, index) => `${String(collected.startLine + index).padStart(width, " ")}\t${line}`,
      )
    : collected.lines;

  if (collected.moreLinesReason === undefined) {
    const complete = `${header}\n${renderedLines.join("\n")}`;
    if (fitsBudget(complete, budget)) {
      return {
        text: complete,
        displayedLineCount: renderedLines.length,
        truncated: false,
      };
    }
  }

  for (let count = renderedLines.length; count >= 0; count -= 1) {
    const nextOffset = collected.startLine + count;
    const suffix =
      collected.moreLinesReason === "limit" && count === renderedLines.length
        ? `[More lines in file. Use offset=${nextOffset} to continue.]`
        : `[Showing lines ${collected.startLine}-${Math.max(collected.startLine, nextOffset - 1)}. ` +
          `Use offset=${nextOffset} to continue.]`;
    const content = renderedLines.slice(0, count).join("\n");
    const candidate = `${header}\n${content}${content.length > 0 ? "\n\n" : ""}${suffix}`;
    if (fitsBudget(candidate, budget)) {
      return {
        text: candidate,
        displayedLineCount: count,
        truncated: collected.moreLinesReason !== "limit" || count < renderedLines.length,
      };
    }
  }

  const fallback = truncateToBudget(`${header}\n[Output truncated for this target.]`, budget);
  return { text: fallback.text, displayedLineCount: 0, truncated: true };
}

async function readTarget(
  target: ReadTargetInput,
  params: ReadToolInput,
  cwd: string,
  signal: AbortSignal | undefined,
  builtInRead: BuiltInRead,
  directoryBudget: DirectoryBudget,
  budget: OutputBudget,
): Promise<TargetOutput> {
  const displayPath = normalizeAtPrefix(target.path);
  const header = `==> ${displayPath} <==`;

  try {
    throwIfAborted(signal);
    const absolutePath = resolveReadPath(target.path, cwd);
    const targetStat = await stat(absolutePath);

    if (targetStat.isDirectory()) {
      if (target.offset !== undefined || target.limit !== undefined) {
        throw new Error("offset and limit apply only to files");
      }
      const listing = await listDirectory(
        absolutePath,
        params.recursive === true,
        params.max_depth ?? defaultRecursiveDepth,
        directoryBudget,
        budget,
        header,
        signal,
      );
      const rendered = renderDirectory(header, listing, budget);
      return {
        text: rendered.text,
        details: {
          path: displayPath,
          kind: "directory",
          entryCount: rendered.entryCount,
          ...(rendered.truncated ? { truncated: true } : {}),
        },
        images: [],
      };
    }

    const prefix = await readFilePrefix(absolutePath, 12, signal);
    if (mightBeSupportedImage(prefix)) {
      const builtInResult = await builtInRead(target, signal);
      const images = builtInResult.content.filter((block) => block.type === "image");
      if (images.length > 0) {
        const fitted = truncateToBudget(`${header}\n${getTextContent(builtInResult)}`, budget);
        return {
          text: fitted.text,
          details: {
            path: displayPath,
            kind: "image",
            ...(fitted.truncated ? { truncated: true } : {}),
          },
          images,
        };
      }
    }

    const headerBytes = Buffer.byteLength(`${header}\n`, "utf-8");
    const collected = await collectTextFile(
      absolutePath,
      targetStat.size,
      target,
      Math.max(0, budget.maxLines - 1),
      Math.max(0, budget.maxBytes - headerBytes),
      signal,
    );
    const file = renderTextFile(
      header,
      absolutePath,
      collected,
      params.show_line_numbers === true,
      budget,
    );
    return {
      text: file.text,
      details: {
        path: displayPath,
        kind: "file",
        lineCount: file.displayedLineCount,
        ...(file.truncated ? { truncated: true } : {}),
      },
      images: [],
    };
  } catch (error: unknown) {
    throwIfAborted(signal);
    const message = error instanceof Error ? error.message : String(error);
    const fitted = truncateToBudget(`${header}\nerror: ${message}`, budget);
    return {
      text: fitted.text,
      details: {
        path: displayPath,
        kind: "error",
        error: message,
        ...(fitted.truncated ? { truncated: true } : {}),
      },
      images: [],
    };
  }
}

export async function executeReadTool(
  params: ReadToolInput,
  cwd: string,
  signal: AbortSignal | undefined,
  builtInRead: BuiltInRead,
): Promise<AgentToolResult<EnhancedReadDetails>> {
  throwIfAborted(signal);
  const directoryBudget: DirectoryBudget = {
    remaining: maxDirectoryEntries,
    limitReached: false,
  };
  const remainingBudget: OutputBudget = {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  };
  const targetDetails: ReadTargetDetails[] = [];
  const images: AgentToolResult<unknown>["content"] = [];
  const outputChunks: string[] = [];

  for (const [index, target] of params.targets.entries()) {
    const separator = index === 0 ? "" : "\n\n";
    const budget = allocateTargetBudget(remainingBudget, params.targets.length - index, separator);
    const output = await readTarget(
      target,
      params,
      cwd,
      signal,
      builtInRead,
      directoryBudget,
      budget,
    );
    targetDetails.push(output.details);
    images.push(...output.images);
    outputChunks.push(output.text);
    remainingBudget.maxLines = Math.max(
      0,
      remainingBudget.maxLines - countOutputLines(output.text),
    );
    remainingBudget.maxBytes = Math.max(
      0,
      remainingBudget.maxBytes - Buffer.byteLength(output.text, "utf-8"),
    );
  }

  return {
    content: [{ type: "text", text: outputChunks.join("\n\n") }, ...images],
    details: {
      targets: targetDetails,
      ...(directoryBudget.limitReached ? { directoryEntryLimitReached: true } : {}),
    },
  };
}
