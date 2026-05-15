/**
 * Register a dedicated apply_patch tool for Codex-style patch edits.
 *
 * This keeps hunk-based patch application separate from exact-text editing.
 */
import {
  defineTool,
  keyHint,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";

import {
  formatDisplayPath,
  getOperationLabel,
  isPartialFailure,
  relativizeDisplayPath,
  relativizeDisplayPathText,
} from "./presentation.ts";
import {
  executeApplyPatchTool,
  applyPatchSchema,
  prepareApplyPatchArguments,
  type ApplyPatchPreview,
  type ApplyPatchPreviewFile,
  type ApplyPatchResult,
  type ApplyPatchToolDetails,
} from "./tool.ts";

type SummaryStatus = "success" | "warning" | "error";
type ThemeBg = Parameters<Theme["bg"]>[0];

interface CollapsedSummaryFile {
  filePath: string;
  moveTo?: string;
  operation: ApplyPatchPreviewFile["operation"];
  added: number;
  removed: number;
}

type CollapsedSummary =
  | { status: SummaryStatus; kind: "text"; text: string }
  | {
      status: SummaryStatus;
      kind: "files";
      files: CollapsedSummaryFile[];
      suffixText?: string;
    };

interface ApplyPatchRenderState {
  collapsedSummary?: CollapsedSummary;
  callComponent?: CollapsedHeaderComponent;
}

interface RenderContextLike {
  args: unknown;
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

interface CollapsedHeaderViewModel {
  background: ThemeBg;
  lines: string[];
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").length;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function setText(lastComponent: unknown, content: string): Text {
  const text = lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
  text.setText(content);
  return text;
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
        return new Array(currentContentLines.length + 2).fill(blankLine);
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

function isRenderState(value: unknown): value is ApplyPatchRenderState {
  return typeof value === "object" && value !== null;
}

function getRenderState(state: unknown): ApplyPatchRenderState {
  if (!isRenderState(state)) {
    throw new Error("apply_patch expected an object render state");
  }
  return state;
}

function rememberCollapsedSummary(context: RenderContextLike, summary: CollapsedSummary): void {
  const state = getRenderState(context.state);
  const previous = state.collapsedSummary;
  if (
    previous !== undefined &&
    previous.status === summary.status &&
    previous.kind === summary.kind &&
    (summary.kind === "text"
      ? previous.kind === "text" && previous.text === summary.text
      : previous.kind === "files" &&
        previous.suffixText === summary.suffixText &&
        previous.files.length === summary.files.length &&
        previous.files.every((file, index) => {
          const other = summary.files[index];
          return (
            other !== undefined &&
            file.filePath === other.filePath &&
            file.moveTo === other.moveTo &&
            file.operation === other.operation &&
            file.added === other.added &&
            file.removed === other.removed
          );
        }))
  ) {
    return;
  }
  state.collapsedSummary = summary;
  context.invalidate();
}

function emptyText(lastComponent: unknown): Text {
  return setText(lastComponent, "");
}

function countPatchOperations(input: string): number {
  return input.match(/^\*\*\* (?:Add|Delete|Update) File:/gm)?.length ?? 0;
}

function formatPatchCall(input: string): string {
  const operationCount = countPatchOperations(input);
  if (operationCount > 0) {
    return pluralize(operationCount, "op", "ops");
  }

  return pluralize(countLines(input), "line", "lines");
}

function renderDeltaSummary(added: number, removed: number, theme: Theme | undefined): string {
  if (theme === undefined) {
    return `+${added} -${removed}`;
  }

  return `${theme.fg("success", `+${added}`)} ${theme.fg("error", `-${removed}`)}`;
}

function buildCollapsedSummaryFiles(
  preview: ApplyPatchPreview | undefined,
): CollapsedSummaryFile[] {
  return (preview?.files ?? []).map((file) => ({
    filePath: file.filePath,
    ...(file.moveTo !== undefined ? { moveTo: file.moveTo } : {}),
    operation: file.operation,
    added: file.added,
    removed: file.removed,
  }));
}

function renderCollapsedFileSummary(file: CollapsedSummaryFile, theme: Theme): string {
  let text = theme.fg(
    "accent",
    formatDisplayPath({
      filePath: file.filePath,
      ...(file.moveTo !== undefined ? { moveTo: file.moveTo } : {}),
    }),
  );

  if (file.added > 0 || file.removed > 0) {
    text += theme.fg("dim", " (");
    text += renderDeltaSummary(file.added, file.removed, theme);
    text += theme.fg("dim", ")");
    return text;
  }

  text += theme.fg("dim", ` (${getOperationLabel(file)})`);
  return text;
}

function renderPreviewFile(file: ApplyPatchPreviewFile, theme: Theme): string {
  let line = theme.fg("dim", `- ${getOperationLabel(file)} ${formatDisplayPath(file)}`);
  if (file.added > 0 || file.removed > 0) {
    line += ` (${renderDeltaSummary(file.added, file.removed, theme)})`;
  }
  return line;
}

function renderExpandedPreviewSummary(
  preview: ApplyPatchPreview | undefined,
  theme: Theme,
): string {
  if (preview === undefined) {
    return "patch";
  }

  let text = pluralize(preview.files.length, "operation", "operations");
  if (preview.added > 0 || preview.removed > 0) {
    text += ` ${renderDeltaSummary(preview.added, preview.removed, theme)}`;
  }
  return text;
}

function buildPreviewSummary(preview: ApplyPatchPreview | undefined): CollapsedSummary {
  if (preview === undefined) {
    return { status: "success", kind: "text", text: "applied" };
  }

  const files = buildCollapsedSummaryFiles(preview);
  if (files.length === 0) {
    return { status: "success", kind: "text", text: "applied" };
  }

  return { status: "success", kind: "files", files };
}

function renderCollapsedSummary(summary: CollapsedSummary, theme: Theme): string {
  if (summary.kind === "text") {
    return theme.fg(summary.status, summary.text);
  }

  let text = summary.files
    .map((file) => renderCollapsedFileSummary(file, theme))
    .join(theme.fg("muted", ", "));
  if (summary.suffixText !== undefined) {
    text += theme.fg("muted", "; ");
    text += theme.fg(summary.status, summary.suffixText);
  }
  return text;
}

function buildCollapsedCallLines(
  target: string,
  summary: CollapsedSummary | undefined,
  theme: Theme,
  expanded: boolean,
  executionStarted: boolean,
): string[] {
  let title = theme.fg("toolTitle", theme.bold("apply_patch"));
  title += ` ${theme.fg("accent", target)}`;

  if (!expanded && summary !== undefined) {
    if (summary.kind === "files" && summary.files.length > 1) {
      if (summary.suffixText !== undefined) {
        title += theme.fg("muted", " -> ");
        title += theme.fg(summary.status, summary.suffixText);
      }
      return [title, ...summary.files.map((file) => renderCollapsedFileSummary(file, theme))];
    }

    title += theme.fg("muted", " -> ");
    title += renderCollapsedSummary(summary, theme);
    return [title];
  }

  if (!expanded && executionStarted) {
    title += theme.fg("warning", " ...");
  }
  return [title];
}

function buildCollapsedHeaderViewModel(
  theme: Theme,
  target: string,
  summary: CollapsedSummary | undefined,
  expanded: boolean,
  executionStarted: boolean,
  isError: boolean,
): CollapsedHeaderViewModel {
  const background =
    isError || summary?.status === "error"
      ? "toolErrorBg"
      : summary?.status === "success"
        ? "toolSuccessBg"
        : "toolPendingBg";

  return {
    background,
    lines: buildCollapsedCallLines(target, summary, theme, expanded, executionStarted),
  };
}

function buildFinalCollapsedSummary(
  details: ApplyPatchToolDetails,
  isError: boolean,
): CollapsedSummary {
  const patchResult = details.result;
  const appliedCount = patchResult?.appliedFiles.length ?? 0;
  const failureCount = patchResult?.failures.length ?? 0;
  const partialFailure = patchResult !== undefined && isPartialFailure(patchResult);

  if (isError) {
    const files = buildCollapsedSummaryFiles(details.preview);
    if (files.length > 0) {
      return {
        status: "error",
        kind: "files",
        files,
        suffixText: partialFailure
          ? `partial failure: ${failureCount} failed`
          : `${failureCount} failed`,
      };
    }

    return {
      status: "error",
      kind: "text",
      text: partialFailure
        ? `partial failure: ${appliedCount} applied, ${failureCount} failed`
        : appliedCount > 0
          ? `${appliedCount} applied, ${failureCount} failed`
          : `${failureCount} failed`,
    };
  }

  return {
    ...buildPreviewSummary(details.preview),
  };
}

function renderCollapsedCall(theme: Theme, context: RenderContextLike, target: string): Component {
  const state = getRenderState(context.state);
  const summary = state.collapsedSummary;
  const viewModel = buildCollapsedHeaderViewModel(
    theme,
    target,
    summary,
    context.expanded,
    context.executionStarted,
    context.isError,
  );

  const component =
    (isCollapsedHeaderComponent(context.lastComponent) ? context.lastComponent : undefined) ??
    state.callComponent ??
    createCollapsedHeaderComponent(theme, viewModel.background, viewModel.lines);
  state.callComponent = component;
  component.setTheme(theme);
  component.setBackground(viewModel.background);
  component.setContentLines(viewModel.lines);
  return component;
}

function syncCollapsedCallComponent(theme: Theme, context: RenderContextLike): void {
  const state = getRenderState(context.state);
  const component = state.callComponent;
  if (component === undefined) {
    return;
  }

  const target = formatPatchCall(prepareApplyPatchArguments(context.args).input);
  const summary = state.collapsedSummary;
  const viewModel = buildCollapsedHeaderViewModel(
    theme,
    target,
    summary,
    context.expanded,
    context.executionStarted,
    context.isError,
  );
  component.setTheme(theme);
  component.setBackground(viewModel.background);
  component.setContentLines(viewModel.lines);
}

function renderDiffLines(diff: string, theme: Theme): string[] {
  return diff.split("\n").map((line) => {
    if (line.startsWith("File: ")) {
      const filePathText = relativizeDisplayPathText(line.slice("File: ".length));
      return theme.fg("accent", theme.bold(`File: ${filePathText}`));
    }
    if (line.startsWith("+")) {
      return theme.fg("toolDiffAdded", line);
    }
    if (line.startsWith("-")) {
      return theme.fg("toolDiffRemoved", line);
    }
    if (line.startsWith(" ")) {
      return theme.fg("toolDiffContext", line);
    }
    return theme.fg("muted", line);
  });
}

function renderFailureLines(result: ApplyPatchResult): string[] {
  const lines: string[] = [];

  if (result.failures.length === 0) {
    return lines;
  }

  lines.push("Failures:");
  for (const failure of result.failures) {
    lines.push(`- ${relativizeDisplayPath(failure.filePath)}: ${failure.message}`);
  }

  if (result.recoveryInstructions.mustReadFiles.length > 0) {
    lines.push(
      `Recovery: reread ${result.recoveryInstructions.mustReadFiles.map((filePath) => relativizeDisplayPath(filePath)).join(", ")} before retrying.`,
    );
  }
  if (result.recoveryInstructions.mustNotReadFiles.length > 0) {
    lines.push(
      `Recovery: do not trust ${result.recoveryInstructions.mustNotReadFiles.map((filePath) => relativizeDisplayPath(filePath)).join(", ")} until rereading the failed paths.`,
    );
  }

  return lines;
}

function pushBlankLine(lines: string[]): void {
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

function buildFinalSummary(
  details: ApplyPatchToolDetails,
  isError: boolean,
  hint: string,
  theme: Theme,
): string {
  const patchResult = details.result;
  const appliedCount = patchResult?.appliedFiles.length ?? details.preview?.files.length ?? 0;
  const failureCount = patchResult?.failures.length ?? 0;
  const partialFailure = patchResult !== undefined && isPartialFailure(patchResult);

  let summary = isError
    ? theme.fg(
        "error",
        partialFailure
          ? `apply_patch partial failure (${appliedCount} applied, ${failureCount} failed)`
          : appliedCount > 0
            ? `apply_patch failed (${appliedCount} applied, ${failureCount} failed)`
            : `apply_patch failed (${failureCount} failed)`,
      )
    : theme.fg("success", "apply_patch applied ") +
      renderExpandedPreviewSummary(details.preview, theme);
  if (patchResult?.details.fuzz !== undefined && patchResult.details.fuzz > 0) {
    summary += theme.fg("warning", ` [fuzz ${patchResult.details.fuzz}]`);
  }
  summary += theme.fg("muted", ` (${hint})`);
  return summary;
}

function appendPreviewSection(
  lines: string[],
  preview: ApplyPatchPreview | undefined,
  theme: Theme,
): void {
  const files = preview?.files ?? [];
  if (files.length === 0) {
    return;
  }

  pushBlankLine(lines);
  for (const file of files) {
    lines.push(renderPreviewFile(file, theme));
  }
}

function appendFailureSection(
  lines: string[],
  result: ApplyPatchResult | undefined,
  theme: Theme,
): void {
  if (result === undefined || result.failures.length === 0) {
    return;
  }

  pushBlankLine(lines);
  for (const line of renderFailureLines(result)) {
    if (line.startsWith("Recovery:")) {
      lines.push(theme.fg("warning", line));
      continue;
    }
    lines.push(theme.fg("error", line));
  }
}

function appendDiffSection(lines: string[], diff: string, theme: Theme): void {
  if (diff.length === 0) {
    return;
  }

  pushBlankLine(lines);
  lines.push(theme.fg("accent", theme.bold("Diff")));
  lines.push(...renderDiffLines(diff, theme));
}

export default function applyPatchExtension(pi: ExtensionAPI): void {
  const tool = defineTool<typeof applyPatchSchema, ApplyPatchToolDetails>({
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply Codex-style patch envelopes with add/delete/update/move file operations.",
    promptSnippet:
      "Apply Codex-style patch envelopes for multi-file edits, updates, adds, deletes, and moves",
    promptGuidelines: [
      "Use apply_patch for hunk-based edits, especially multi-file changes, renames, adds, deletes, or context-based updates.",
      "Pass the full patch text in apply_patch.input.",
      "apply_patch accepts relative or absolute file paths in patch headers.",
    ],
    parameters: applyPatchSchema,
    prepareArguments: prepareApplyPatchArguments,
    renderShell: "self",
    renderCall(args, theme, context) {
      return renderCollapsedCall(theme, context, formatPatchCall(args.input));
    },
    renderResult(result, options, theme, context) {
      const hint = keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand");
      const details = result.details;

      rememberCollapsedSummary(context, buildFinalCollapsedSummary(details, context.isError));
      syncCollapsedCallComponent(theme, context);
      const summary = buildFinalSummary(details, context.isError, hint, theme);

      if (!options.expanded) {
        return emptyText(context.lastComponent);
      }

      const lines = [summary];
      appendPreviewSection(lines, details.preview, theme);
      appendFailureSection(lines, details.result, theme);
      appendDiffSection(lines, details.diff, theme);

      return setText(context.lastComponent, lines.join("\n"));
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return executeApplyPatchTool(toolCallId, params, signal, onUpdate, ctx.cwd);
    },
  });

  pi.registerTool(tool);
}
