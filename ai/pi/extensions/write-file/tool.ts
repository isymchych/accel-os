import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

import { resolvePatchPath } from "../apply-patch/parser.ts";
import { relativizeDisplayPath } from "../apply-patch/presentation.ts";
import { generateDiffSummary } from "../apply-patch/preview.ts";
import { createRealWorkspace, withWorkspaceLocks } from "../apply-patch/workspace.ts";

export const writeFileSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Relative or absolute path to write. '@' prefixes are treated as path sigils and stripped.",
    }),
    content: Type.String({
      description: "Full desired file contents.",
    }),
    mode: StringEnum(["create", "replace"] as const, {
      description: "Whether to create a new file or replace an existing one.",
    }),
  },
  { additionalProperties: false },
);

export type WriteFileInput = Static<typeof writeFileSchema>;
export type WriteFileMode = WriteFileInput["mode"];
export type WriteFileStatus = "created" | "replaced" | "unchanged";

export interface WriteFilePreview {
  filePath: string;
  operation: "add" | "update";
  added: number;
  removed: number;
}

export interface WriteFileResult {
  path: string;
  status: WriteFileStatus;
  summary: string;
  wrote: boolean;
}

export interface WriteFileToolDetails {
  path: string;
  mode: WriteFileMode;
  diff: string;
  firstChangedLine?: number;
  preview?: WriteFilePreview;
  result?: WriteFileResult;
  error?: string;
}

export interface WriteFileToolResult {
  content: [{ type: "text"; text: string }];
  details: WriteFileToolDetails;
  isError?: boolean;
  terminate?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildCombinedDiff(filePath: string, diff: string): string {
  if (diff.length === 0) {
    return "";
  }
  return `File: ${filePath}\n${diff}`;
}

function buildSuccessSummary(status: WriteFileStatus, displayPath: string): string {
  if (status === "created") {
    return `Created file ${displayPath}.`;
  }
  if (status === "replaced") {
    return `Replaced file ${displayPath}.`;
  }
  return `Verified ${displayPath} already matched the requested content.`;
}

function buildFailureResult(
  absolutePath: string,
  mode: WriteFileMode,
  error: unknown,
): WriteFileToolResult {
  const message = getErrorMessage(error);
  const details: WriteFileToolDetails = {
    path: absolutePath,
    mode,
    diff: "",
    error: message,
  };

  return {
    content: [{ type: "text", text: `write_file failed: ${message}` }],
    details,
    isError: true,
    terminate: true,
  };
}

export function parseWriteFileArguments(args: unknown): Partial<WriteFileInput> {
  if (!isRecord(args)) {
    return {};
  }

  const path = typeof args["path"] === "string" ? args["path"] : undefined;
  const content = typeof args["content"] === "string" ? args["content"] : undefined;
  const mode = args["mode"] === "create" || args["mode"] === "replace" ? args["mode"] : undefined;
  return {
    ...(path === undefined ? {} : { path }),
    ...(content === undefined ? {} : { content }),
    ...(mode === undefined ? {} : { mode }),
  };
}

export async function executeWriteFileTool(
  _toolCallId: string,
  params: WriteFileInput,
  _signal: AbortSignal | undefined,
  _onUpdate:
    | ((partialResult: {
        content: [{ type: "text"; text: string }];
        details: WriteFileToolDetails;
      }) => void)
    | undefined,
  cwd: string,
): Promise<WriteFileToolResult> {
  const absolutePath = resolvePatchPath(cwd, params.path);

  return withWorkspaceLocks([absolutePath], async () => {
    const workspace = createRealWorkspace();

    try {
      const exists = await workspace.exists(absolutePath);
      if (params.mode === "create" && exists) {
        throw new Error(
          `Failed to create ${relativizeDisplayPath(absolutePath, cwd)}: file already exists.`,
        );
      }
      if (params.mode === "replace" && !exists) {
        throw new Error(
          `Failed to replace ${relativizeDisplayPath(absolutePath, cwd)}: file does not exist.`,
        );
      }

      const previousContent = exists ? await workspace.readText(absolutePath) : "";
      const wrote = !exists || previousContent !== params.content;
      if (wrote) {
        await workspace.writeText(absolutePath, params.content);
      }

      const diff = generateDiffSummary(previousContent, params.content);
      const preview: WriteFilePreview = {
        filePath: absolutePath,
        operation: exists ? "update" : "add",
        added: diff.added,
        removed: diff.removed,
      };
      const status: WriteFileStatus = !exists ? "created" : wrote ? "replaced" : "unchanged";
      const summary = buildSuccessSummary(status, relativizeDisplayPath(absolutePath, cwd));
      const details: WriteFileToolDetails = {
        path: absolutePath,
        mode: params.mode,
        diff: buildCombinedDiff(absolutePath, diff.diff),
        ...(diff.firstChangedLine === undefined ? {} : { firstChangedLine: diff.firstChangedLine }),
        preview,
        result: {
          path: absolutePath,
          status,
          summary,
          wrote,
        },
      };

      return {
        content: [{ type: "text", text: summary }],
        details,
      };
    } catch (error) {
      return buildFailureResult(absolutePath, params.mode, error);
    }
  });
}
