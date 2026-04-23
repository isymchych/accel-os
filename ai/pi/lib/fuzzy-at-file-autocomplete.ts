import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { fuzzyMatch } from "@mariozechner/pi-tui";

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
const DIRECTORY_BONUS = 20;
const BASENAME_BONUS = 18;
const EXACT_BASENAME_BONUS = 28;
const PREFIX_BASENAME_BONUS = 22;
const EXACT_SEGMENT_BONUS = 14;
const PREFIX_SEGMENT_BONUS = 12;
const BASENAME_START_BONUS = 10;
const SEGMENT_BOUNDARY_BONUS = 8;
const CONTIGUOUS_SUBSTRING_BONUS = 6;
const PARENT_DIRECTORY_PENALTY = 6;
const SHALLOW_PATH_FACTOR = 0.5;
const MAX_SUGGESTIONS = 20;

export interface FdQueryPlan {
  searchRoot: string;
  displayPrefix: string;
  fuzzyQuery: string;
  includeHidden: boolean;
}

export interface CandidateEntry {
  path: string;
  isDirectory: boolean;
}

function toDisplayPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLastDelimiter(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (PATH_DELIMITERS.has(text[index] ?? "")) {
      return index;
    }
  }
  return -1;
}

function findUnclosedQuoteStart(text: string): number | null {
  let inQuotes = false;
  let quoteStart = -1;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') {
      continue;
    }

    inQuotes = !inQuotes;
    if (inQuotes) {
      quoteStart = index;
    }
  }

  return inQuotes ? quoteStart : null;
}

function isTokenStart(text: string, index: number): boolean {
  return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

function needsQuotes(path: string, quoted: boolean): boolean {
  return quoted || path.includes(" ");
}

function expandHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

export function extractAtFileToken(textBeforeCursor: string): string | null {
  const quoteStart = findUnclosedQuoteStart(textBeforeCursor);
  if (quoteStart !== null && quoteStart > 0 && textBeforeCursor[quoteStart - 1] === "@") {
    if (isTokenStart(textBeforeCursor, quoteStart - 1)) {
      return textBeforeCursor.slice(quoteStart - 1);
    }
    return null;
  }

  const lastDelimiterIndex = findLastDelimiter(textBeforeCursor);
  const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
  if (textBeforeCursor[tokenStart] !== "@") {
    return null;
  }

  return textBeforeCursor.slice(tokenStart);
}

export function parseAtFileToken(token: string): { rawQuery: string; quoted: boolean } {
  if (token.startsWith('@"')) {
    return { rawQuery: token.slice(2), quoted: true };
  }

  return { rawQuery: token.slice(1), quoted: false };
}

export function getActiveQuerySegment(rawQuery: string): string {
  const normalized = toDisplayPath(rawQuery);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

export function shouldIncludeHidden(rawQuery: string): boolean {
  return getActiveQuerySegment(rawQuery).startsWith(".");
}

export function planFdQuery(basePath: string, rawQuery: string): FdQueryPlan {
  const normalized = toDisplayPath(rawQuery);
  const slashIndex = normalized.lastIndexOf("/");
  const displayPrefix = slashIndex === -1 ? "" : normalized.slice(0, slashIndex + 1);
  const fuzzyQuery = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
  const resolvedBasePath = resolve(basePath);
  const includeHidden = shouldIncludeHidden(rawQuery);

  if (displayPrefix.length === 0) {
    return {
      searchRoot: resolvedBasePath,
      displayPrefix,
      fuzzyQuery,
      includeHidden,
    };
  }

  const scopedRoot = displayPrefix.startsWith("~/")
    ? expandHomePath(displayPrefix)
    : resolve(basePath, displayPrefix);
  if (existsSync(scopedRoot)) {
    return {
      searchRoot: scopedRoot,
      displayPrefix,
      fuzzyQuery,
      includeHidden,
    };
  }

  return {
    searchRoot: resolvedBasePath,
    displayPrefix: "",
    fuzzyQuery: normalized,
    includeHidden,
  };
}

export function buildFdPattern(query: string): string {
  const normalized = toDisplayPath(query).trim();
  if (normalized.length === 0) {
    return ".";
  }

  return normalized
    .split("")
    .map((char) => escapeRegex(char))
    .join(".*");
}

function buildCompletionValue(
  displayPath: string,
  options: { isDirectory: boolean; quoted: boolean },
): string {
  const completionPath = options.isDirectory ? `${displayPath}/` : displayPath;
  if (!needsQuotes(completionPath, options.quoted)) {
    return `@${completionPath}`;
  }
  return `@"${completionPath}"`;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function scoreCandidate(entry: CandidateEntry, query: string): number | null {
  const normalizedPath = toDisplayPath(entry.path);
  const depth = normalizedPath.split("/").length;

  if (query.length === 0) {
    return depth * SHALLOW_PATH_FACTOR - (entry.isDirectory ? DIRECTORY_BONUS : 0);
  }

  const lowerQuery = query.toLowerCase();
  const lowerPath = normalizedPath.toLowerCase();
  const pathMatch = fuzzyMatch(lowerQuery, lowerPath);
  if (!pathMatch.matches) {
    return null;
  }

  const fileName = basename(lowerPath);
  const segments = lowerPath.split("/");
  const basenameIndex = lowerPath.lastIndexOf("/") + 1;
  const firstMatchIndex = lowerPath.indexOf(lowerQuery[0] ?? "");
  const contiguousPathIndex = lowerPath.indexOf(lowerQuery);
  const contiguousBasenameIndex = fileName.indexOf(lowerQuery);
  const exactSegmentIndex = segments.findIndex((segment) => segment === lowerQuery);
  const prefixSegmentIndex = segments.findIndex((segment) => segment.startsWith(lowerQuery));

  let score = pathMatch.score + depth * SHALLOW_PATH_FACTOR;
  if (entry.isDirectory) {
    score -= DIRECTORY_BONUS;
  }

  if (fileName === lowerQuery) {
    score -= EXACT_BASENAME_BONUS;
  } else if (fileName.startsWith(lowerQuery)) {
    score -= PREFIX_BASENAME_BONUS;
  } else if (fileName.includes(lowerQuery)) {
    score -= BASENAME_BONUS;
  }

  if (exactSegmentIndex !== -1) {
    score -= EXACT_SEGMENT_BONUS;
    if (exactSegmentIndex < segments.length - 1) {
      score += PARENT_DIRECTORY_PENALTY;
    }
  } else if (prefixSegmentIndex !== -1) {
    score -= PREFIX_SEGMENT_BONUS;
    if (prefixSegmentIndex < segments.length - 1) {
      score += PARENT_DIRECTORY_PENALTY;
    }
  }

  if (contiguousBasenameIndex === 0) {
    score -= BASENAME_START_BONUS;
  }

  if (contiguousPathIndex !== -1) {
    score -= CONTIGUOUS_SUBSTRING_BONUS;
    const boundaryIndex = contiguousPathIndex - 1;
    if (boundaryIndex < 0 || "/._-".includes(lowerPath[boundaryIndex] ?? "")) {
      score -= SEGMENT_BOUNDARY_BONUS;
    }
  } else if (firstMatchIndex === basenameIndex) {
    score -= BASENAME_START_BONUS / 2;
  }

  return score;
}

export function rankCandidates(entries: CandidateEntry[], query: string): CandidateEntry[] {
  const scored = entries
    .map((entry) => {
      const score = scoreCandidate(entry, query);
      return score === null ? null : { entry, score };
    })
    .filter((entry): entry is { entry: CandidateEntry; score: number } => entry !== null);

  scored.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    if (left.entry.isDirectory !== right.entry.isDirectory) {
      return left.entry.isDirectory ? -1 : 1;
    }
    return compareStrings(left.entry.path, right.entry.path);
  });

  return scored.map((entry) => entry.entry);
}

export function formatAutocompleteItems(
  entries: CandidateEntry[],
  options: { displayPrefix: string; quoted: boolean },
): AutocompleteItem[] {
  return entries.slice(0, MAX_SUGGESTIONS).map((entry) => {
    const normalizedPath = toDisplayPath(entry.path);
    const displayPath = `${options.displayPrefix}${normalizedPath}`;
    return {
      value: buildCompletionValue(displayPath, {
        isDirectory: entry.isDirectory,
        quoted: options.quoted,
      }),
      label: `${basename(normalizedPath)}${entry.isDirectory ? "/" : ""}`,
      description: displayPath,
    };
  });
}

export function dedupeCandidates(entries: CandidateEntry[]): CandidateEntry[] {
  const seen = new Set<string>();
  const deduped: CandidateEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.isDirectory ? "d" : "f"}:${toDisplayPath(entry.path)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      path: toDisplayPath(entry.path),
      isDirectory: entry.isDirectory,
    });
  }

  return deduped;
}

export function joinDisplayPath(prefix: string, path: string): string {
  return `${toDisplayPath(prefix)}${toDisplayPath(path)}`;
}
