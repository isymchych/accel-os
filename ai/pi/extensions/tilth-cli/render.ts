import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import type {
  TilthDepsInput,
  TilthFilesInput,
  TilthGrokInput,
  TilthReadInput,
  TilthSearchInput,
  TilthToolDetails,
} from "./tool.ts";

type SummaryStatus = "success" | "warning";

interface CompactSummary {
  status: SummaryStatus;
  label: string;
}

interface CompactRenderState {
  collapsedSummary?: CompactSummary;
}

interface RenderContextLike {
  args: Record<string, unknown>;
  state: unknown;
  lastComponent: unknown;
  invalidate: () => void;
  expanded: boolean;
  isError: boolean;
  executionStarted: boolean;
  cwd: string;
}

function countLines(text: string): number {
  const normalized = text.replace(/\r/g, "").replace(/\n+$/g, "");
  if (normalized.length === 0) {
    return 0;
  }
  return normalized.split("\n").length;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function firstLine(text: string): string {
  const [line = ""] = text.split("\n", 1);
  return line;
}

function setText(lastComponent: unknown, content: string): Text {
  const text = lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
  text.setText(content);
  return text;
}

function emptyText(lastComponent: unknown): Text {
  return setText(lastComponent, "");
}

function isCompactRenderState(value: unknown): value is CompactRenderState {
  return typeof value === "object" && value !== null;
}

function getCompactState(state: unknown): CompactRenderState {
  if (!isCompactRenderState(state)) {
    throw new Error("tilth-cli expected an object render state");
  }
  return state;
}

function rememberCollapsedSummary(context: RenderContextLike, summary: CompactSummary): void {
  const state = getCompactState(context.state);
  const previous = state.collapsedSummary;
  if (previous?.status === summary.status && previous.label === summary.label) {
    return;
  }

  state.collapsedSummary = summary;
  context.invalidate();
}

function expandHome(pathText: string): string {
  if (pathText === "~") {
    return homedir();
  }
  if (pathText.startsWith("~/")) {
    return resolve(homedir(), pathText.slice(2));
  }
  return pathText;
}

function formatRelativePath(pathText: string, cwd: string): string {
  const expanded = expandHome(pathText);
  const absolutePath = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const displayPath = relative(cwd, absolutePath);
  return displayPath.length === 0 ? "." : displayPath;
}

function renderCollapsedCall(
  lastComponent: unknown,
  theme: Theme,
  context: RenderContextLike,
  toolLabel: string,
  target: string,
): Text {
  const state = getCompactState(context.state);
  let text = `  ${theme.fg("toolTitle", theme.bold(toolLabel))}`;
  if (target.length > 0) {
    text += ` ${theme.fg("accent", target)}`;
  }

  if (context.isError) {
    text = theme.bg("toolErrorBg", ` ${text} `);
  } else if (!context.expanded && state.collapsedSummary !== undefined) {
    text += theme.fg("muted", " -> ");
    text += theme.fg(state.collapsedSummary.status, state.collapsedSummary.label);
  } else if (!context.expanded && context.executionStarted) {
    text += theme.fg("warning", " ...");
  }

  return setText(lastComponent, text);
}

function getPrimaryText(result: AgentToolResult<TilthToolDetails>): string {
  for (const block of result.content) {
    if (block.type === "text") {
      return block.text;
    }
  }
  return "";
}

function renderExpandedOutput(
  result: AgentToolResult<TilthToolDetails>,
  theme: Theme,
  context: RenderContextLike,
): Text {
  const output = getPrimaryText(result).trimEnd();
  if (output.length === 0) {
    return new Text(theme.fg("dim", "tilth returned no output."), 0, 0);
  }

  const lineCount = countLines(output);
  const summary = theme.fg("muted", `↳ ${pluralize(lineCount, "line", "lines")}.`);
  const color = context.isError ? "error" : "toolOutput";
  const body = output
    .split("\n")
    .map((line) => theme.fg(color, line))
    .join("\n");
  return new Text(`${summary}\n${body}`, 0, 0);
}

function buildCollapsedSummary(result: AgentToolResult<TilthToolDetails>): CompactSummary {
  const output = getPrimaryText(result).trimEnd();
  if (output.length === 0) {
    return { status: "warning", label: "no output" };
  }

  return {
    status: "success",
    label: pluralize(countLines(output), "line", "lines"),
  };
}

export function renderTilthResult(
  result: AgentToolResult<TilthToolDetails>,
  options: { expanded: boolean; isPartial?: boolean },
  theme: Theme,
  context: RenderContextLike,
): Text {
  if (options.expanded || options.isPartial === true || context.isError) {
    return renderExpandedOutput(result, theme, context);
  }

  rememberCollapsedSummary(context, buildCollapsedSummary(result));
  return emptyText(context.lastComponent);
}

export function renderTilthReadCall(
  args: TilthReadInput,
  theme: Theme,
  context: RenderContextLike,
): Text {
  let target = formatRelativePath(args.path, context.cwd);
  if (args.section !== undefined) {
    target += ` §${args.section}`;
  }
  if (args.full === true) {
    target += " [full]";
  }
  return renderCollapsedCall(context.lastComponent, theme, context, "tilth_read", target);
}

export function renderTilthSearchCall(
  args: TilthSearchInput,
  theme: Theme,
  context: RenderContextLike,
): Text {
  let target = truncate(args.query, 48);
  const suffixes: string[] = [];
  if (args.mode !== undefined && args.mode !== "auto") {
    suffixes.push(args.mode);
  }
  if (args.scope !== undefined && args.scope.trim().length > 0) {
    suffixes.push(formatRelativePath(args.scope, context.cwd));
  }
  if (args.expand !== undefined) {
    suffixes.push(`expand=${args.expand}`);
  }
  if (args.full === true) {
    suffixes.push("full");
  }
  if (args.glob !== undefined) {
    suffixes.push(truncate(args.glob, 24));
  }
  if (suffixes.length > 0) {
    target += ` (${suffixes.join(", ")})`;
  }
  return renderCollapsedCall(context.lastComponent, theme, context, "tilth_search", target);
}

export function renderTilthFilesCall(
  args: TilthFilesInput,
  theme: Theme,
  context: RenderContextLike,
): Text {
  let target = truncate(args.pattern, 48);
  if (args.scope !== undefined && args.scope.trim().length > 0) {
    target += ` in ${formatRelativePath(args.scope, context.cwd)}`;
  }
  return renderCollapsedCall(context.lastComponent, theme, context, "tilth_files", target);
}

export function renderTilthDepsCall(
  args: TilthDepsInput,
  theme: Theme,
  context: RenderContextLike,
): Text {
  let target = formatRelativePath(args.path, context.cwd);
  if (args.scope !== undefined && args.scope.trim().length > 0) {
    target += ` in ${formatRelativePath(args.scope, context.cwd)}`;
  }
  return renderCollapsedCall(context.lastComponent, theme, context, "tilth_deps", target);
}

export function renderTilthGrokCall(
  args: TilthGrokInput,
  theme: Theme,
  context: RenderContextLike,
): Text {
  let target = truncate(args.target, 48);
  const suffixes: string[] = [];
  if (args.scope !== undefined && args.scope.trim().length > 0) {
    suffixes.push(formatRelativePath(args.scope, context.cwd));
  }
  if (args.full === true) {
    suffixes.push("full");
  }
  if (suffixes.length > 0) {
    target += ` (${suffixes.join(", ")})`;
  }
  return renderCollapsedCall(context.lastComponent, theme, context, "tilth_grok", target);
}

export function summarizeTilthOutput(text: string): string {
  const output = text.trimEnd();
  if (output.length === 0) {
    return "no output";
  }

  const lineCount = countLines(output);
  const first = truncate(firstLine(output), 72);
  return `${pluralize(lineCount, "line", "lines")}: ${first}`;
}
