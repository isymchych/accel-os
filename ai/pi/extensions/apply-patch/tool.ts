export { executeApplyPatchTool } from "./engine.ts";
export {
  applyPatchSchema,
  type ApplyPatchFailure,
  type ApplyPatchInput,
  type ApplyPatchPreview,
  type ApplyPatchPreviewFile,
  type ApplyPatchRecoveryInstructions,
  type ApplyPatchResult,
  type ApplyPatchToolDetails,
  type ApplyPatchToolResult,
  type PatchOperation,
  type UpdateChunk,
} from "./model.ts";
export { parsePatch } from "./parser.ts";

import type { ApplyPatchInput } from "./model.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function prepareApplyPatchArguments(args: unknown): ApplyPatchInput {
  if (typeof args === "string") {
    return { input: args };
  }

  if (isRecord(args)) {
    if (typeof args["input"] === "string") {
      return { input: args["input"] };
    }
    if (typeof args["patch"] === "string") {
      return { input: args["patch"] };
    }
  }

  return { input: "" };
}
