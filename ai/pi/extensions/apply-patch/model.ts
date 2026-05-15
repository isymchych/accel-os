import { type Static, Type } from "typebox";

export const applyPatchSchema = Type.Object(
  {
    input: Type.String({
      description: "Full Codex-style apply_patch payload (*** Begin Patch ... *** End Patch).",
    }),
  },
  { additionalProperties: false },
);

export type ApplyPatchInput = Static<typeof applyPatchSchema>;

export type ApplyPatchOperationKind = "add" | "delete" | "update";

export interface UpdateChunk {
  changeContexts: string[];
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

export type PatchOperation =
  | { kind: "add"; path: string; contents: string }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; chunks: UpdateChunk[] };

export interface ApplyPatchPreviewFile {
  filePath: string;
  moveTo?: string;
  operation: ApplyPatchOperationKind;
  diff: string;
  added: number;
  removed: number;
}

export interface ApplyPatchPreview {
  files: ApplyPatchPreviewFile[];
  added: number;
  removed: number;
}

export interface ApplyPatchFailure {
  filePath: string;
  operation: ApplyPatchOperationKind;
  message: string;
  recoveryPaths?: string[];
  wroteFiles?: string[];
}

export interface ApplyPatchRecoveryInstructions {
  mustReadFiles: string[];
  mustNotReadFiles: string[];
}

export interface ApplyPatchResult {
  summaries: string[];
  appliedFiles: string[];
  failures: ApplyPatchFailure[];
  hasPartialSuccess: boolean;
  recoveryInstructions: ApplyPatchRecoveryInstructions;
  details: {
    fuzz: number;
  };
}

export interface ApplyPatchToolDetails {
  diff: string;
  firstChangedLine?: number;
  preview?: ApplyPatchPreview;
  result?: ApplyPatchResult;
}

export interface ApplyPatchToolResult {
  content: [{ type: "text"; text: string }];
  details: ApplyPatchToolDetails;
  isError?: boolean;
  terminate?: boolean;
}
