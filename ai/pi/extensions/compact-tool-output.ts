import { homedir } from "node:os";

import type {
  ExtensionAPI,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { executeNumberedRead } from "../lib/read-with-line-numbers.ts";

/**
 * Dense collapsed rendering for Pi's built-in `read`, `find`, `grep`, `ls`, and `write` tools.
 *
 * Execution still delegates to Pi's built-ins. The collapsed TUI view is reduced to a single
 * self-rendered line per tool row; expanded and error rendering still delegate to Pi's built-ins.
 * `bash` and `edit` are intentionally left unchanged.
 */

type ReadToolDefinition = ReturnType<typeof createReadToolDefinition>;
type FindToolDefinition = ReturnType<typeof createFindToolDefinition>;
type GrepToolDefinition = ReturnType<typeof createGrepToolDefinition>;
type LsToolDefinition = ReturnType<typeof createLsToolDefinition>;
type WriteToolDefinition = ReturnType<typeof createWriteToolDefinition>;

interface BuiltInTools {
  read: ReadToolDefinition;
  find: FindToolDefinition;
  grep: GrepToolDefinition;
  ls: LsToolDefinition;
  write: WriteToolDefinition;
}

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
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").length;
}

function countNonEmptyLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").filter((line) => line.length > 0).length;
}

function getFirstTextBlock(content: readonly { type: string }[]): string | undefined {
  for (const block of content) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") {
      return block.text;
    }
  }
  return undefined;
}

function setText(lastComponent: unknown, content: string): Text {
  const text = lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
  text.setText(content);
  return text;
}

function isCompactRenderState(value: unknown): value is CompactRenderState {
  return typeof value === "object" && value !== null;
}

function getCompactState(state: unknown): CompactRenderState {
  if (!isCompactRenderState(state)) {
    throw new Error("compact-tool-output expected an object render state");
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

function emptyText(lastComponent: unknown): Text {
  return setText(lastComponent, "");
}

function shortenPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function truncationSuffix(truncated: boolean): string {
  return truncated ? " [truncated]" : "";
}

function firstLine(text: string): string {
  const [line = ""] = text.split("\n", 1);
  return line;
}

function formatReadTarget(
  path: string,
  offset: number | undefined,
  limit: number | undefined,
  showLineNumbers: boolean | undefined,
): string {
  let target = shortenPath(path);
  if (offset !== undefined || limit !== undefined) {
    const startLine = offset ?? 1;
    const endLine = limit !== undefined ? startLine + limit - 1 : undefined;
    target += endLine !== undefined ? `:${startLine}-${endLine}` : `:${startLine}`;
  }
  if (showLineNumbers === true) {
    target += " [numbered]";
  }
  return truncate(target, 90);
}

const numberedReadSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
  show_line_numbers: Type.Optional(
    Type.Boolean({
      description:
        "Whether to prefix each returned text line with its file line number. Useful when line references matter.",
    }),
  ),
});

type NumberedReadParams = {
  path: string;
  offset?: number;
  limit?: number;
  show_line_numbers?: boolean;
};

function toBuiltInReadParams(params: NumberedReadParams): {
  path: string;
  offset?: number;
  limit?: number;
} {
  return {
    path: params.path,
    ...(params.offset !== undefined ? { offset: params.offset } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  };
}

function renderCollapsedCall(
  lastComponent: unknown,
  theme: Theme,
  context: RenderContextLike,
  toolLabel: string,
  target: string,
): Text {
  const state = getCompactState(context.state);
  let text = "  " + theme.fg("toolTitle", theme.bold(toolLabel));
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

const toolCache = new Map<string, BuiltInTools>();

function createBuiltInTools(cwd: string): BuiltInTools {
  return {
    read: createReadToolDefinition(cwd),
    find: createFindToolDefinition(cwd),
    grep: createGrepToolDefinition(cwd),
    ls: createLsToolDefinition(cwd),
    write: createWriteToolDefinition(cwd),
  };
}

function getBuiltInTools(cwd: string): BuiltInTools {
  const cached = toolCache.get(cwd);
  if (cached !== undefined) {
    return cached;
  }

  const tools = createBuiltInTools(cwd);
  toolCache.set(cwd, tools);
  return tools;
}

function registerReadTool(pi: ExtensionAPI, startupTools: BuiltInTools): void {
  const tool = defineTool<typeof numberedReadSchema, ReadToolDetails | undefined>({
    ...startupTools.read,
    description:
      `${startupTools.read.description} ` +
      "Set show_line_numbers=true to prefix returned text lines with their original file line numbers.",
    ...(startupTools.read.promptSnippet !== undefined
      ? { promptSnippet: startupTools.read.promptSnippet }
      : {}),
    promptGuidelines: [
      ...(startupTools.read.promptGuidelines ?? []),
      "Use show_line_numbers=true when you need exact file line references in read output.",
    ],
    parameters: numberedReadSchema,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const builtIn = getBuiltInTools(ctx.cwd).read;
      const builtInParams = toBuiltInReadParams(params);

      if (params.show_line_numbers !== true) {
        return builtIn.execute(toolCallId, builtInParams, signal, onUpdate, ctx);
      }

      const builtInResult = await builtIn.execute(toolCallId, builtInParams, signal, onUpdate, ctx);
      if (builtInResult.content.some((block) => block.type === "image")) {
        return builtInResult;
      }

      return executeNumberedRead(builtInParams, ctx.cwd, signal);
    },
    renderCall(args, theme, context) {
      const target = formatReadTarget(args.path, args.offset, args.limit, args.show_line_numbers);
      return renderCollapsedCall(context.lastComponent, theme, context, "read", target);
    },
    renderResult(result, options, theme, context) {
      const builtIn = getBuiltInTools(context.cwd).read;
      if (options.expanded || options.isPartial || context.isError) {
        return (
          builtIn.renderResult?.(result, options, theme, context) ??
          emptyText(context.lastComponent)
        );
      }

      const imageBlock = result.content.find((block) => block.type === "image");
      if (imageBlock !== undefined) {
        rememberCollapsedSummary(context, { status: "success", label: "image loaded" });
        return emptyText(context.lastComponent);
      }

      const textContent = getFirstTextBlock(result.content);
      const lineCount = textContent === undefined ? 0 : countLines(textContent);
      const details: ReadToolDetails | undefined = result.details;
      rememberCollapsedSummary(context, {
        status: "success",
        label:
          pluralize(lineCount, "line", "lines") +
          truncationSuffix(details?.truncation?.truncated === true),
      });
      return emptyText(context.lastComponent);
    },
  });

  pi.registerTool(tool);
}

function registerFindTool(pi: ExtensionAPI, startupTools: BuiltInTools): void {
  const tool: FindToolDefinition = {
    ...startupTools.find,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const pattern = truncate(args.pattern, 40);
      const path = shortenPath(args.path ?? ".");
      const target = truncate(`${pattern} in ${path}`, 90);
      return renderCollapsedCall(context.lastComponent, theme, context, "find", target);
    },
    renderResult(result, options, theme, context) {
      const builtIn = getBuiltInTools(context.cwd).find;
      if (options.expanded || options.isPartial || context.isError) {
        return (
          builtIn.renderResult?.(result, options, theme, context) ??
          emptyText(context.lastComponent)
        );
      }

      const textContent = getFirstTextBlock(result.content) ?? "";
      const fileCount = countNonEmptyLines(textContent);
      const details: FindToolDetails | undefined = result.details;
      let label = pluralize(fileCount, "file", "files");
      if (details?.resultLimitReached !== undefined) {
        label += " [limit]";
      }
      label += truncationSuffix(details?.truncation?.truncated === true);

      rememberCollapsedSummary(context, { status: "success", label });
      return emptyText(context.lastComponent);
    },
  };

  pi.registerTool(tool);
}

function registerGrepTool(pi: ExtensionAPI, startupTools: BuiltInTools): void {
  const tool: GrepToolDefinition = {
    ...startupTools.grep,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const pattern = truncate(args.pattern, 40);
      const path = shortenPath(args.path ?? ".");
      let target = `/${pattern}/ in ${path}`;
      if (args.glob !== undefined) {
        target += ` (${truncate(args.glob, 24)})`;
      }
      return renderCollapsedCall(
        context.lastComponent,
        theme,
        context,
        "grep",
        truncate(target, 90),
      );
    },
    renderResult(result, options, theme, context) {
      const builtIn = getBuiltInTools(context.cwd).grep;
      if (options.expanded || options.isPartial || context.isError) {
        return (
          builtIn.renderResult?.(result, options, theme, context) ??
          emptyText(context.lastComponent)
        );
      }

      const textContent = getFirstTextBlock(result.content) ?? "";
      const outputLineCount = countNonEmptyLines(textContent);
      const details: GrepToolDetails | undefined = result.details;
      const contextLines = typeof context.args.context === "number" ? context.args.context : 0;
      const labelBase =
        contextLines > 0
          ? pluralize(outputLineCount, "output line", "output lines")
          : pluralize(outputLineCount, "match", "matches");

      let label = labelBase;
      if (details?.matchLimitReached !== undefined) {
        label += " [limit]";
      }
      if (details?.linesTruncated === true) {
        label += " [line truncation]";
      }
      label += truncationSuffix(details?.truncation?.truncated === true);

      rememberCollapsedSummary(context, { status: "success", label });
      return emptyText(context.lastComponent);
    },
  };

  pi.registerTool(tool);
}

function registerLsTool(pi: ExtensionAPI, startupTools: BuiltInTools): void {
  const tool: LsToolDefinition = {
    ...startupTools.ls,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      return renderCollapsedCall(
        context.lastComponent,
        theme,
        context,
        "ls",
        truncate(shortenPath(args.path ?? "."), 90),
      );
    },
    renderResult(result, options, theme, context) {
      const builtIn = getBuiltInTools(context.cwd).ls;
      if (options.expanded || options.isPartial || context.isError) {
        return (
          builtIn.renderResult?.(result, options, theme, context) ??
          emptyText(context.lastComponent)
        );
      }

      const textContent = getFirstTextBlock(result.content) ?? "";
      const entryCount = countNonEmptyLines(textContent);
      const details: LsToolDetails | undefined = result.details;
      let label = pluralize(entryCount, "entry", "entries");
      if (details?.entryLimitReached !== undefined) {
        label += " [limit]";
      }
      label += truncationSuffix(details?.truncation?.truncated === true);

      rememberCollapsedSummary(context, { status: "success", label });
      return emptyText(context.lastComponent);
    },
  };

  pi.registerTool(tool);
}

function registerWriteTool(pi: ExtensionAPI, startupTools: BuiltInTools): void {
  const tool: WriteToolDefinition = {
    ...startupTools.write,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const path = shortenPath(args.path);
      const lineCount = countLines(args.content);
      const target = truncate(`${path} (${pluralize(lineCount, "line", "lines")})`, 90);
      return renderCollapsedCall(context.lastComponent, theme, context, "write", target);
    },
    renderResult(result, options, theme, context) {
      const builtIn = getBuiltInTools(context.cwd).write;
      if (options.expanded || options.isPartial || context.isError) {
        return (
          builtIn.renderResult?.(result, options, theme, context) ??
          emptyText(context.lastComponent)
        );
      }

      const textContent = getFirstTextBlock(result.content);
      if (textContent !== undefined && textContent.length > 0) {
        rememberCollapsedSummary(context, {
          status: "warning",
          label: truncate(firstLine(textContent), 60),
        });
        return emptyText(context.lastComponent);
      }

      rememberCollapsedSummary(context, { status: "success", label: "written" });
      return emptyText(context.lastComponent);
    },
  };

  pi.registerTool(tool);
}

export default function compactToolOutput(pi: ExtensionAPI): void {
  const startupTools = getBuiltInTools(process.cwd());

  registerReadTool(pi, startupTools);
  registerFindTool(pi, startupTools);
  registerGrepTool(pi, startupTools);
  registerLsTool(pi, startupTools);
  registerWriteTool(pi, startupTools);
}
