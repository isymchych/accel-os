import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";

import { pluralize, setCompactText } from "../shared/compact-tool-render.ts";
import { executeReadTool, type EnhancedReadDetails, type ReadTargetDetails } from "./execute.ts";
import { readToolSchema, type ReadToolInput } from "./schema.ts";

/**
 * Replaces Pi's single-file read tool with one canonical reader for files, images, and directories.
 * The tool accepts ordered batches, divides the output budget fairly across targets, and owns its
 * compact TUI rendering so execution and presentation cannot be split across competing `read`
 * overrides.
 */

const toolCache = new Map<string, ReturnType<typeof createReadToolDefinition>>();
type SummaryStatus = "success" | "warning";
type ThemeBg = Parameters<Theme["bg"]>[0];

interface CollapsedSummary {
  status: SummaryStatus;
  targets: readonly ReadTargetDetails[];
  truncated: boolean;
}

interface ReadRenderState {
  collapsedSummary?: CollapsedSummary;
  callComponent?: CollapsedHeaderComponent;
}

interface RenderContextLike {
  args: ReadToolInput;
  state: unknown;
  lastComponent: unknown;
  invalidate: () => void;
  expanded: boolean;
  isError: boolean;
  executionStarted: boolean;
}

interface CollapsedHeaderComponent extends Component {
  setTheme: (theme: Theme) => void;
  setBackground: (background: ThemeBg) => void;
  setContentLines: (contentLines: string[]) => void;
}

function getBuiltInRead(cwd: string): ReturnType<typeof createReadToolDefinition> {
  const cached = toolCache.get(cwd);
  if (cached !== undefined) {
    return cached;
  }
  const tool = createReadToolDefinition(cwd);
  toolCache.set(cwd, tool);
  return tool;
}

function formatCallTarget(
  targets: ReadToolInput["targets"],
  recursive: boolean | undefined,
): string {
  let label = pluralize(targets.length, "target", "targets");
  if (recursive === true) {
    label += " [recursive]";
  }
  return label;
}

function createCollapsedHeaderComponent(
  theme: Theme,
  background: ThemeBg,
  contentLines: string[],
): CollapsedHeaderComponent {
  let currentTheme = theme;
  let currentBackground = background;
  let currentContentLines = contentLines;

  return {
    setTheme(nextTheme) {
      currentTheme = nextTheme;
    },
    setBackground(nextBackground) {
      currentBackground = nextBackground;
    },
    setContentLines(nextContentLines) {
      currentContentLines = nextContentLines;
    },
    render(width) {
      if (width <= 0) {
        return [];
      }

      const blankLine = currentTheme.bg(currentBackground, " ".repeat(width));
      if (width <= 2) {
        return new Array<string>(currentContentLines.length + 2).fill(blankLine);
      }

      const lines = [blankLine];
      for (const contentLine of currentContentLines) {
        const inner = truncateToWidth(contentLine, width - 2, "...", true);
        lines.push(currentTheme.bg(currentBackground, ` ${inner} `));
      }
      lines.push(blankLine);
      return lines;
    },
    invalidate() {},
  };
}

function isCollapsedHeaderComponent(value: unknown): value is CollapsedHeaderComponent {
  return typeof value === "object" && value !== null && "setContentLines" in value;
}

function getRenderState(state: unknown): ReadRenderState {
  if (typeof state !== "object" || state === null) {
    throw new Error("read expected an object render state");
  }
  return state;
}

function renderTargetSummary(target: ReadTargetDetails, theme: Theme): string {
  let detail: string;
  switch (target.kind) {
    case "file":
      detail = `${target.lineCount ?? 0}L`;
      break;
    case "directory":
      detail = pluralize(target.entryCount ?? 0, "entry", "entries");
      break;
    case "image":
      detail = "image";
      break;
    case "error":
      detail = "failed";
      break;
    default:
      detail = "";
  }
  if (target.truncated === true) {
    detail += `${detail.length > 0 ? ", " : ""}truncated`;
  }
  return `${theme.fg("accent", target.path)}${theme.fg("dim", ` (${detail})`)}`;
}

function summarizeDetails(details: EnhancedReadDetails): CollapsedSummary {
  const truncated =
    details.targets.some((target) => target.truncated === true) ||
    details.directoryEntryLimitReached === true;

  return {
    status:
      details.targets.some((target) => target.kind === "error") || truncated
        ? "warning"
        : "success",
    targets: details.targets,
    truncated,
  };
}

function rememberCollapsedSummary(context: RenderContextLike, summary: CollapsedSummary): void {
  const state = getRenderState(context.state);
  const previous = state.collapsedSummary;
  if (
    previous?.status === summary.status &&
    previous.truncated === summary.truncated &&
    previous.targets === summary.targets
  ) {
    return;
  }
  state.collapsedSummary = summary;
  context.invalidate();
}

function buildCollapsedCallLines(
  target: string,
  summary: CollapsedSummary | undefined,
  theme: Theme,
  expanded: boolean,
  executionStarted: boolean,
): string[] {
  let title = theme.fg("toolTitle", theme.bold("read"));
  title += ` ${theme.fg("accent", target)}`;

  if (!expanded && summary !== undefined) {
    if (summary.targets.length > 1) {
      if (summary.truncated) {
        title += theme.fg("warning", " [truncated]");
      }
      return [title, ...summary.targets.map((item) => renderTargetSummary(item, theme))];
    }

    const [singleTarget] = summary.targets;
    if (singleTarget !== undefined) {
      title += theme.fg("muted", " -> ");
      title += renderTargetSummary(singleTarget, theme);
    }
    return [title];
  }

  if (!expanded && executionStarted) {
    title += theme.fg("warning", " ...");
  }
  return [title];
}

function renderCollapsedCall(
  theme: Theme,
  context: RenderContextLike,
  target: string,
): CollapsedHeaderComponent {
  const state = getRenderState(context.state);
  const summary = state.collapsedSummary;
  const background = context.isError
    ? "toolErrorBg"
    : summary?.status === "success"
      ? "toolSuccessBg"
      : "toolPendingBg";
  const lines = buildCollapsedCallLines(
    target,
    summary,
    theme,
    context.expanded,
    context.executionStarted,
  );
  const component =
    (isCollapsedHeaderComponent(context.lastComponent) ? context.lastComponent : undefined) ??
    state.callComponent ??
    createCollapsedHeaderComponent(theme, background, lines);
  state.callComponent = component;
  component.setTheme(theme);
  component.setBackground(background);
  component.setContentLines(lines);
  return component;
}

function syncCollapsedCallComponent(theme: Theme, context: RenderContextLike): void {
  const component = getRenderState(context.state).callComponent;
  if (component === undefined) {
    return;
  }
  const args = context.args;
  component.setTheme(theme);
  component.setBackground(
    context.isError
      ? "toolErrorBg"
      : getRenderState(context.state).collapsedSummary?.status === "success"
        ? "toolSuccessBg"
        : "toolPendingBg",
  );
  component.setContentLines(
    buildCollapsedCallLines(
      formatCallTarget(args.targets, args.recursive),
      getRenderState(context.state).collapsedSummary,
      theme,
      context.expanded,
      context.executionStarted,
    ),
  );
}

function getTextOutput(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n");
}

export function renderExpandedText(
  content: readonly { type: string; text?: string }[],
  theme: Theme,
): string {
  const output = stripTerminalSequences(getTextOutput(content));
  return output.length === 0 ? "" : `\n${theme.fg("toolOutput", output)}`;
}

function renderExpandedResult(
  content: readonly { type: string; text?: string }[],
  theme: Theme,
  lastComponent: unknown,
): ReturnType<typeof setCompactText> {
  return setCompactText(lastComponent, renderExpandedText(content, theme));
}

export default function readToolExtension(pi: ExtensionAPI): void {
  const tool = defineTool<typeof readToolSchema, EnhancedReadDetails>({
    name: "read",
    label: "read",
    description:
      "Read one or more files or directories. Text files support per-target offset/limit and optional " +
      "line numbers. Images are returned as attachments. Directories include entry type, size, and " +
      "symlink target, and can optionally be listed recursively without following directory symlinks. " +
      "The complete call is limited to 2000 lines or 50KB, divided fairly across targets. Input shape: " +
      "{ targets: [{ path, offset?, limit? }], recursive?, max_depth?, show_line_numbers? }. Put offset " +
      "and limit inside each target, never at the root; for example: { targets: [{ path: 'justfile', " +
      "offset: 1, limit: 160 }] }.",
    promptSnippet: "Read files or list directory contents",
    promptGuidelines: [
      "Use read for one or more known file or directory paths instead of cat, sed, or ls.",
      "Put path, offset, and limit inside each targets item; never send path, offset, or limit at the root.",
      "Use read with show_line_numbers=true when exact file line references matter.",
      "Use read recursive directory listing only when the directory tree itself is needed; use grep or find for repository discovery.",
    ],
    parameters: readToolSchema,
    renderShell: "self",
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const builtIn = getBuiltInRead(ctx.cwd);
      return executeReadTool(params, ctx.cwd, signal, async (target, targetSignal) =>
        builtIn.execute(toolCallId, target, targetSignal, undefined, ctx),
      );
    },
    renderCall(args, theme, context) {
      return renderCollapsedCall(theme, context, formatCallTarget(args.targets, args.recursive));
    },
    renderResult(result, options, theme, context) {
      if (options.expanded || options.isPartial || context.isError) {
        return renderExpandedResult(result.content, theme, context.lastComponent);
      }

      rememberCollapsedSummary(context, summarizeDetails(result.details));
      syncCollapsedCallComponent(theme, context);
      return setCompactText(context.lastComponent, "");
    },
  });

  pi.registerTool(tool);
}
