import { constants, existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";

import type { AgentToolResult, ReadToolDetails } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";

export interface NumberedReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

const unicodeSpaces = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const narrowNoBreakSpace = "\u202F";

function fileExists(path: string): boolean {
  return existsSync(path);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted ?? false) {
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

function tryMacOsScreenshotPath(path: string): string {
  return path.replace(/ (AM|PM)\./gi, `${narrowNoBreakSpace}$1.`);
}

function tryNfdVariant(path: string): string {
  return path.normalize("NFD");
}

function tryCurlyQuoteVariant(path: string): string {
  return path.replace(/'/g, "\u2019");
}

function resolveReadPath(path: string, cwd: string): string {
  const expanded = expandPath(path);
  const resolved = isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
  if (fileExists(resolved)) {
    return resolved;
  }

  const amPmVariant = tryMacOsScreenshotPath(resolved);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) {
    return amPmVariant;
  }

  const nfdVariant = tryNfdVariant(resolved);
  if (nfdVariant !== resolved && fileExists(nfdVariant)) {
    return nfdVariant;
  }

  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && fileExists(curlyVariant)) {
    return curlyVariant;
  }

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) {
    return nfdCurlyVariant;
  }

  return resolved;
}

function isEmptyFileLines(lines: readonly string[]): boolean {
  return lines.length === 1 && lines[0] === "";
}

function formatNumberedLines(lines: readonly string[], startLine: number, endLine: number): string {
  if (isEmptyFileLines(lines)) {
    return "";
  }

  const width = String(endLine).length;
  return lines
    .slice(startLine, endLine)
    .map((line, index) => `${String(startLine + index + 1).padStart(width, " ")}\t${line}`)
    .join("\n");
}

export async function executeNumberedRead(
  params: NumberedReadInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentToolResult<ReadToolDetails | undefined>> {
  throwIfAborted(signal);

  const absolutePath = resolveReadPath(params.path, cwd);
  await access(absolutePath, constants.R_OK);

  throwIfAborted(signal);

  const textContent = await readFile(absolutePath, "utf-8");
  const allLines = textContent.split("\n");
  const totalFileLines = allLines.length;
  const startLine = params.offset !== undefined ? Math.max(0, params.offset - 1) : 0;
  const startLineDisplay = startLine + 1;

  if (startLine >= allLines.length) {
    throw new Error(
      `Offset ${params.offset} is beyond end of file (${allLines.length} lines total)`,
    );
  }

  const endLine =
    params.limit !== undefined
      ? Math.min(startLine + params.limit, allLines.length)
      : allLines.length;
  const userLimitedLines = endLine - startLine;
  const numberedContent = formatNumberedLines(allLines, startLine, endLine);
  const truncation = truncateHead(numberedContent);

  let outputText: string;
  let details: ReadToolDetails | undefined;

  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine] ?? "", "utf-8"));
    outputText =
      `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. ` +
      `Use bash: nl -ba ${params.path} | sed -n '${startLineDisplay}p' | head -c ${DEFAULT_MAX_BYTES}]`;
    details = { truncation };
  } else if (truncation.truncated) {
    const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
    const nextOffset = endLineDisplay + 1;
    outputText = truncation.content;

    if (truncation.truncatedBy === "lines") {
      outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
    } else {
      outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
    }

    details = { truncation };
  } else if (params.limit !== undefined && startLine + userLimitedLines < allLines.length) {
    const remaining = allLines.length - (startLine + userLimitedLines);
    const nextOffset = startLine + userLimitedLines + 1;
    outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  } else {
    outputText = truncation.content;
  }

  return {
    content: [{ type: "text", text: outputText }],
    details,
  };
}
