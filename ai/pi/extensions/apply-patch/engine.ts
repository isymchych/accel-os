import {
  applyPatchOperation,
  buildApplyPatchResult,
  buildPreviewState,
  toApplyPatchFailure,
} from "./apply.ts";
import type {
  ApplyPatchInput,
  ApplyPatchPreview,
  ApplyPatchResult,
  ApplyPatchToolDetails,
  ApplyPatchToolResult,
  PatchOperation,
} from "./model.ts";
import { parsePatch, resolvePatchPath } from "./parser.ts";
import { formatFailureMessage, formatSuccessMessage } from "./presentation.ts";
import { buildCombinedDiff, buildFirstChangedLine, buildPreview } from "./preview.ts";
import {
  createRealWorkspace,
  createVirtualWorkspace,
  type Workspace,
  withWorkspaceLocks,
} from "./workspace.ts";

interface ApplyPatchExecutionOptions {
  createRealWorkspace?: () => Workspace;
}

async function runSequentially<T>(
  items: readonly T[],
  handler: (item: T, index: number) => Promise<void>,
  index = 0,
): Promise<void> {
  if (index >= items.length) {
    return;
  }

  const item = items[index];
  if (item === undefined) {
    return;
  }

  await handler(item, index);
  await runSequentially(items, handler, index + 1);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildDetails(
  diff: string,
  preview?: ApplyPatchPreview,
  result?: ApplyPatchResult,
  firstChangedLine?: number,
): ApplyPatchToolDetails {
  const details: ApplyPatchToolDetails = { diff };
  if (firstChangedLine !== undefined) {
    details.firstChangedLine = firstChangedLine;
  }
  if (preview !== undefined) {
    details.preview = preview;
  }
  if (result !== undefined) {
    details.result = result;
  }
  return details;
}

function getTargetPaths(cwd: string, operations: readonly PatchOperation[]): string[] {
  const targetPaths = new Set<string>();
  for (const operation of operations) {
    targetPaths.add(resolvePatchPath(cwd, operation.path));
    if (operation.kind === "update" && operation.moveTo !== undefined) {
      targetPaths.add(resolvePatchPath(cwd, operation.moveTo));
    }
  }
  return [...targetPaths].sort();
}

async function assertPreflight(
  operations: readonly PatchOperation[],
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await buildPreviewState(operations, createVirtualWorkspace(cwd), cwd, signal);
  } catch (error) {
    throw new Error(`Preflight failed before mutating files.\n${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

export async function executeApplyPatchTool(
  _toolCallId: string,
  params: ApplyPatchInput,
  signal: AbortSignal | undefined,
  _onUpdate:
    | ((partialResult: {
        content: [{ type: "text"; text: string }];
        details: ApplyPatchToolDetails;
      }) => void)
    | undefined,
  cwd: string,
  options?: ApplyPatchExecutionOptions,
): Promise<ApplyPatchToolResult> {
  const operations = parsePatch(params.input);
  await assertPreflight(operations, cwd, signal);

  return withWorkspaceLocks(getTargetPaths(cwd, operations), async () => {
    await assertPreflight(operations, cwd, signal);

    const summaries: string[] = [];
    const appliedFiles: string[] = [];
    const failures: ApplyPatchResult["failures"] = [];
    const appliedPreviewFiles: ApplyPatchPreview["files"] = [];
    const appliedChangedLines: Array<{ firstChangedLine?: number }> = [];
    let fuzz = 0;

    const workspace = options?.createRealWorkspace?.() ?? createRealWorkspace();
    await runSequentially(operations, async (operation) => {
      try {
        const success = await applyPatchOperation(operation, workspace, cwd, signal);
        summaries.push(success.summary);
        appliedFiles.push(success.appliedFile);
        appliedPreviewFiles.push(success.previewFile);
        appliedChangedLines.push(
          success.firstChangedLine === undefined
            ? {}
            : { firstChangedLine: success.firstChangedLine },
        );
        fuzz += success.fuzz;
      } catch (error) {
        failures.push(toApplyPatchFailure(operation, error));
      }
    });

    const result = buildApplyPatchResult(summaries, appliedFiles, failures, fuzz);
    const preview = buildPreview(appliedPreviewFiles);
    const diff = buildCombinedDiff(appliedPreviewFiles);
    const firstChangedLine = buildFirstChangedLine(appliedChangedLines);
    const details = buildDetails(diff, preview, result, firstChangedLine);

    if (failures.length > 0) {
      return {
        content: [{ type: "text", text: formatFailureMessage(result) }],
        details,
        isError: true,
        terminate: true,
      };
    }

    return {
      content: [{ type: "text", text: formatSuccessMessage(result) }],
      details,
    };
  });
}
