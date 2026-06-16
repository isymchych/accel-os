/**
 * Register a dedicated write_file tool for whole-file create/replace writes.
 *
 * This keeps exact full-file writes separate from hunk-based patch editing.
 */
import {
  defineTool,
  keyHint,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { relativizeDisplayPath, relativizeDisplayPathText } from "../apply-patch/presentation.ts";
import {
  executeWriteFileTool,
  parseWriteFileArguments,
  writeFileSchema,
  type WriteFilePreview,
  type WriteFileToolDetails,
} from "./tool.ts";

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").length;
}

function renderDeltaSummary(added: number, removed: number, success = true): string {
  if (added === 0 && removed === 0) {
    return "no diff";
  }
  return success ? `+${added} -${removed}` : `failed (+${added} -${removed})`;
}

function renderDiffLines(diff: string, theme: Theme, cwd: string): string[] {
  return diff.split("\n").map((line) => {
    if (line.startsWith("File: ")) {
      const filePathText = relativizeDisplayPathText(line.slice("File: ".length), cwd);
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

function renderPreview(preview: WriteFilePreview, theme: Theme, cwd: string): string {
  let line = theme.fg(
    "dim",
    `- ${preview.operation} ${relativizeDisplayPath(preview.filePath, cwd)}`,
  );
  if (preview.added > 0 || preview.removed > 0) {
    line += theme.fg("dim", ` (+${preview.added} -${preview.removed})`);
  }
  return line;
}

function renderCall(
  args: unknown,
  theme: Theme,
  context: {
    lastComponent: unknown;
    cwd: string;
  },
): Text {
  const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const parsed = parseWriteFileArguments(args);
  const target = parsed.path === undefined ? "" : relativizeDisplayPath(parsed.path, context.cwd);
  const lineText =
    theme.fg("toolTitle", theme.bold("write_file")) +
    (parsed.mode === undefined ? "" : ` ${theme.fg("muted", parsed.mode)}`) +
    (target.length === 0 ? "" : ` ${theme.fg("accent", target)}`) +
    (parsed.content === undefined
      ? ""
      : theme.fg("dim", ` (${pluralize(countLines(parsed.content), "line", "lines")})`));
  text.setText(lineText);
  return text;
}

export default function writeFileExtension(pi: ExtensionAPI): void {
  const tool = defineTool<typeof writeFileSchema, WriteFileToolDetails>({
    name: "write_file",
    label: "write_file",
    description:
      "Write a full file in create or replace mode. Missing parent directories are created automatically.",
    promptSnippet: "Write complete file contents with explicit create or replace intent",
    promptGuidelines: [
      "Use write_file when you already know the complete desired contents of a file.",
      "Set mode=create only when the file must not already exist.",
      "Set mode=replace only when the file must already exist and you want to replace its full contents.",
      "Use apply_patch instead for localized edits, moves, deletes, or multi-file patch-style changes.",
    ],
    parameters: writeFileSchema,
    renderCall,
    renderResult(result, options, theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      const hint = keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand");
      const details = result.details;
      const preview = details.preview;
      const delta =
        preview === undefined
          ? undefined
          : renderDeltaSummary(preview.added, preview.removed, !context.isError);

      let summary = context.isError
        ? theme.fg("error", `write_file failed: ${details.error ?? "unknown error"}`)
        : theme.fg("success", details.result?.summary ?? "write_file completed.");

      if (delta !== undefined) {
        summary += theme.fg("muted", ` (${delta})`);
      }
      summary += theme.fg("muted", ` (${hint})`);

      if (!options.expanded) {
        text.setText(summary);
        return text;
      }

      const lines = [summary];
      if (preview !== undefined) {
        lines.push("", renderPreview(preview, theme, context.cwd));
      }
      if (details.diff.length > 0) {
        lines.push(
          "",
          theme.fg("accent", theme.bold("Diff")),
          ...renderDiffLines(details.diff, theme, context.cwd),
        );
      }

      text.setText(lines.join("\n"));
      return text;
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return executeWriteFileTool(toolCallId, params, signal, onUpdate, ctx.cwd);
    },
  });

  pi.registerTool(tool);
}
