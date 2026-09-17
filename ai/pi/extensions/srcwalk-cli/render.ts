import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import type { SrcwalkToolDetails } from "./tool.ts";

type SummaryStatus = "success" | "warning";

interface CompactSummary {
  status: SummaryStatus;
  label: string;
}

interface CompactRenderState {
  collapsedSummary?: CompactSummary;
}

interface RenderContextLike {
  state: unknown;
  lastComponent: unknown;
  invalidate: () => void;
  expanded: boolean;
  isError: boolean;
  executionStarted: boolean;
  cwd: string;
}

function getState(value: unknown): CompactRenderState {
  if (typeof value !== "object" || value === null) {
    throw new Error("srcwalk-cli expected an object render state");
  }
  return value;
}

function setText(component: unknown, content: string): Text {
  const text = component instanceof Text ? component : new Text("", 0, 0);
  text.setText(content);
  return text;
}

function lineCount(text: string): number {
  const normalized = text.replace(/\r/g, "").replace(/\n+$/g, "");
  return normalized.length === 0 ? 0 : normalized.split("\n").length;
}

function pluralize(count: number): string {
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function truncate(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 3))}...`;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

export function formatSrcwalkPath(value: string, cwd: string): string {
  const normalized = value.startsWith("@") ? value.slice(1) : value;
  const expanded = expandHome(normalized);
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const display = relative(cwd, absolute);
  return display.length === 0 ? "." : display;
}

function primaryText(result: AgentToolResult<SrcwalkToolDetails>): string {
  return result.content.find((block) => block.type === "text")?.text ?? "";
}

export function renderSrcwalkCall(
  toolName: string,
  target: string,
  theme: Theme,
  context: RenderContextLike,
): Text {
  const state = getState(context.state);
  let text = `  ${theme.fg("toolTitle", theme.bold(toolName))}`;
  if (target.length > 0) {
    text += ` ${theme.fg("accent", truncate(target, 80))}`;
  }
  if (context.isError) {
    text = theme.bg("toolErrorBg", ` ${text} `);
  } else if (!context.expanded && state.collapsedSummary !== undefined) {
    text += theme.fg("muted", " -> ");
    text += theme.fg(state.collapsedSummary.status, state.collapsedSummary.label);
  } else if (!context.expanded && context.executionStarted) {
    text += theme.fg("warning", " ...");
  }
  return setText(context.lastComponent, text);
}

export function renderSrcwalkResult(
  result: AgentToolResult<SrcwalkToolDetails>,
  options: { expanded: boolean; isPartial?: boolean },
  theme: Theme,
  context: RenderContextLike,
): Text {
  const output = primaryText(result).trimEnd();
  if (options.expanded || options.isPartial === true || context.isError) {
    if (output.length === 0) {
      return setText(context.lastComponent, theme.fg("dim", "srcwalk returned no output."));
    }
    const color = context.isError ? "error" : "toolOutput";
    return setText(
      context.lastComponent,
      `${theme.fg("muted", `↳ ${pluralize(lineCount(output))}.`)}\n${output
        .split("\n")
        .map((line) => theme.fg(color, line))
        .join("\n")}`,
    );
  }

  const summary: CompactSummary =
    output.length === 0
      ? { status: "warning", label: "no output" }
      : {
          status: result.details.truncated ? "warning" : "success",
          label: `${pluralize(lineCount(output))}${result.details.truncated ? ", truncated" : ""}`,
        };
  const state = getState(context.state);
  if (
    state.collapsedSummary?.status !== summary.status ||
    state.collapsedSummary.label !== summary.label
  ) {
    state.collapsedSummary = summary;
    context.invalidate();
  }
  return setText(context.lastComponent, "");
}
