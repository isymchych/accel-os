import {
  applyPatchOperation,
  buildApplyPatchResult,
  buildPreviewState,
  PatchOperationApplyError,
  toApplyPatchFailure,
} from "./apply.ts";
import type {
  ApplyPatchInput,
  ApplyPatchFileUpdateMode,
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

export interface ApplyPatchExecutionOptions {
  createRealWorkspace?: () => Workspace;
  updateFileMode?: ApplyPatchFileUpdateMode;
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

async function getPreflightFailure(
  operations: readonly PatchOperation[],
  cwd: string,
  updateFileMode: ApplyPatchFileUpdateMode,
  signal?: AbortSignal,
): Promise<ApplyPatchResult["failures"][number] | undefined> {
  try {
    await buildPreviewState(operations, createVirtualWorkspace(cwd), cwd, updateFileMode, signal);
    return undefined;
  } catch (error) {
    if (!(error instanceof PatchOperationApplyError)) {
      throw error;
    }

    const operation = operations[error.operationIndex];
    if (operation === undefined) {
      throw error;
    }

    const recoveryPaths =
      operation.kind === "update" && operation.moveTo !== undefined
        ? [operation.path, operation.moveTo]
        : [operation.path];
    return {
      filePath: operation.path,
      operation: operation.kind,
      message: error.message,
      phase: "preflight",
      operationIndex: error.operationIndex,
      ...(error.chunkIndex === undefined ? {} : { chunkIndex: error.chunkIndex }),
      recoveryPaths,
    };
  }
}

function buildPreflightFailureResult(
  failure: ApplyPatchResult["failures"][number],
): ApplyPatchToolResult {
  const result = buildApplyPatchResult([], [], [failure], 0);
  return {
    content: [{ type: "text", text: formatFailureMessage(result) }],
    details: buildDetails("", undefined, result),
  };
}

function assertOperationsAreValid(operations: readonly PatchOperation[], cwd: string): void {
  if (operations.length === 0) {
    throw new Error("No files were modified.");
  }

  const sourcePaths = new Set<string>();
  for (const operation of operations) {
    const sourcePath = resolvePatchPath(cwd, operation.path);
    if (sourcePaths.has(sourcePath)) {
      throw new Error(`Multiple operations target ${operation.path}.`);
    }
    sourcePaths.add(sourcePath);
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
  const updateFileMode = options?.updateFileMode ?? "preserve";
  assertOperationsAreValid(operations, cwd);
  const preflightFailure = await getPreflightFailure(operations, cwd, updateFileMode, signal);
  if (preflightFailure !== undefined) {
    return buildPreflightFailureResult(preflightFailure);
  }

  return withWorkspaceLocks(getTargetPaths(cwd, operations), async () => {
    const lockedPreflightFailure = await getPreflightFailure(
      operations,
      cwd,
      updateFileMode,
      signal,
    );
    if (lockedPreflightFailure !== undefined) {
      return buildPreflightFailureResult(lockedPreflightFailure);
    }

    const summaries: string[] = [];
    const appliedFiles: string[] = [];
    const failures: ApplyPatchResult["failures"] = [];
    const appliedPreviewFiles: ApplyPatchPreview["files"] = [];
    const appliedChangedLines: Array<{ firstChangedLine?: number }> = [];
    let fuzz = 0;

    const workspace = options?.createRealWorkspace?.() ?? createRealWorkspace();
    for (const operation of operations) {
      try {
        const success = await applyPatchOperation(
          operation,
          workspace,
          cwd,
          updateFileMode,
          signal,
        );
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
        break;
      }
    }

    const result = buildApplyPatchResult(summaries, appliedFiles, failures, fuzz);
    const preview = buildPreview(appliedPreviewFiles);
    const diff = buildCombinedDiff(appliedPreviewFiles);
    const firstChangedLine = buildFirstChangedLine(appliedChangedLines);
    const details = buildDetails(diff, preview, result, firstChangedLine);

    if (failures.length > 0) {
      return {
        content: [{ type: "text", text: formatFailureMessage(result) }],
        details,
      };
    }

    return {
      content: [{ type: "text", text: formatSuccessMessage(result) }],
      details,
    };
  });
}
