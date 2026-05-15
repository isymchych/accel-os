import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import process from "node:process";

import type { ApplyPatchPreviewFile, ApplyPatchResult } from "./model.ts";

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function isPartialFailure(result: ApplyPatchResult): boolean {
  return result.hasPartialSuccess;
}

export function relativizeDisplayPath(filePath: string, cwd = process.cwd()): string {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return filePath;
  }

  const absolutePath = isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(cwd, trimmed);
  const relativePath = relative(cwd, absolutePath);
  return relativePath.length === 0 ? "." : relativePath;
}

export function relativizeDisplayPathText(filePathText: string, cwd = process.cwd()): string {
  const [fromPath, moveTo] = filePathText.split(" -> ");
  if (fromPath === undefined) {
    return filePathText;
  }
  if (moveTo === undefined) {
    return relativizeDisplayPath(fromPath, cwd);
  }
  return `${relativizeDisplayPath(fromPath, cwd)} -> ${relativizeDisplayPath(moveTo, cwd)}`;
}

export function formatDisplayPath(
  file: Pick<ApplyPatchPreviewFile, "filePath" | "moveTo">,
  cwd = process.cwd(),
): string {
  const fromPath = relativizeDisplayPath(file.filePath, cwd);
  if (file.moveTo === undefined) {
    return fromPath;
  }
  return `${fromPath} -> ${relativizeDisplayPath(file.moveTo, cwd)}`;
}

export function getOperationLabel(
  file: Pick<ApplyPatchPreviewFile, "operation" | "moveTo">,
): string {
  if (file.operation === "add") {
    return "add";
  }
  if (file.operation === "delete") {
    return "delete";
  }
  if (file.moveTo !== undefined) {
    return "move";
  }
  return "update";
}

export function formatSuccessMessage(result: ApplyPatchResult): string {
  const lines = [`Applied ${pluralize(result.summaries.length, "operation", "operations")}.`];
  for (const [index, summary] of result.summaries.entries()) {
    lines.push(`${index + 1}. ${summary}`);
  }
  return lines.join("\n");
}

export function formatFailureMessage(result: ApplyPatchResult): string {
  const lines = [
    result.summaries.length > 0
      ? `apply_patch failed after applying ${pluralize(result.summaries.length, "operation", "operations")}.`
      : isPartialFailure(result)
        ? "apply_patch failed after partially applying operations."
        : "apply_patch failed before applying any operations.",
  ];

  if (result.summaries.length > 0) {
    lines.push("Applied:");
    for (const [index, summary] of result.summaries.entries()) {
      lines.push(`${index + 1}. ${summary}`);
    }
  }

  lines.push("Failed:");
  for (const failure of result.failures) {
    lines.push(`- ${failure.filePath}: ${failure.message}`);
  }

  if (result.recoveryInstructions.mustReadFiles.length > 0) {
    lines.push(
      `Recovery: reread ${result.recoveryInstructions.mustReadFiles.join(", ")} before retrying.`,
    );
  }
  if (result.recoveryInstructions.mustNotReadFiles.length > 0) {
    lines.push(
      `Recovery: do not trust ${result.recoveryInstructions.mustNotReadFiles.join(", ")} until rereading the failed paths.`,
    );
  }

  return lines.join("\n");
}
