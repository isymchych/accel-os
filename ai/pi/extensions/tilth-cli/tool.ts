import { createRequire } from "node:module";
import path from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const require = createRequire(import.meta.url);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_SEARCH_EXPAND = 2;
const REGEX_METACHAR_PATTERN = /[()[\]{}*+?|\\^$]/;

export const tilthToolNames = [
  "tilth_read",
  "tilth_search",
  "tilth_files",
  "tilth_deps",
  "tilth_grok",
] as const;

export const tilthReadSchema = Type.Object(
  {
    path: Type.String({
      description: "File path to read.",
    }),
    scope: Type.Optional(
      Type.String({
        description: "Optional subdirectory to resolve relative paths against.",
      }),
    ),
    section: Type.Optional(
      Type.String({
        description: "Line range like '45-89' or a heading like '## Installation'.",
      }),
    ),
    full: Type.Optional(
      Type.Boolean({
        description: "Force the full file instead of Tilth's smart outline.",
      }),
    ),
    budget: Type.Optional(
      Type.Number({
        description: "Optional max token budget for the response.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const tilthSearchSchema = Type.Object(
  {
    query: Type.String({
      description: "Symbol, concept, exact text, or regex to search for.",
    }),
    mode: Type.Optional(
      StringEnum(["auto", "literal", "regex", "callers"] as const, {
        description:
          "Search mode. auto lets Tilth classify the query, literal forces exact text search, regex forces regex search, callers finds call sites.",
      }),
    ),
    scope: Type.Optional(
      Type.String({
        description: "Optional subdirectory to search within.",
      }),
    ),
    expand: Type.Optional(
      Type.Number({
        description: "Number of top matches to expand inline. Defaults to 2.",
      }),
    ),
    full: Type.Optional(
      Type.Boolean({
        description: "Expand all matches, subject to Tilth's internal output limits.",
      }),
    ),
    budget: Type.Optional(
      Type.Number({
        description: "Optional max token budget for the response.",
      }),
    ),
    glob: Type.Optional(
      Type.String({
        description: "Optional file pattern filter like '*.ts' or '!*.test.ts'.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const tilthFilesSchema = Type.Object(
  {
    pattern: Type.String({
      description: "Glob pattern to list, for example '*.ts' or 'src/**/*.rs'.",
    }),
    scope: Type.Optional(
      Type.String({
        description: "Optional subdirectory to list within.",
      }),
    ),
    budget: Type.Optional(
      Type.Number({
        description: "Optional max token budget for the response.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const tilthDepsSchema = Type.Object(
  {
    path: Type.String({
      description: "File path to analyze for imports and dependents.",
    }),
    scope: Type.Optional(
      Type.String({
        description: "Optional subdirectory to search for dependents within.",
      }),
    ),
    budget: Type.Optional(
      Type.Number({
        description: "Optional max token budget for the response.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const tilthGrokSchema = Type.Object(
  {
    target: Type.String({
      description: "Symbol, qualified name, or path:line target to grok.",
    }),
    scope: Type.Optional(
      Type.String({
        description: "Optional subdirectory to narrow the search.",
      }),
    ),
    full: Type.Optional(
      Type.Boolean({
        description: "Widen Tilth's grok caps for callers, callees, siblings, and tests.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type TilthReadInput = Static<typeof tilthReadSchema>;
export type TilthSearchInput = Static<typeof tilthSearchSchema>;
export type TilthFilesInput = Static<typeof tilthFilesSchema>;
export type TilthDepsInput = Static<typeof tilthDepsSchema>;
export type TilthGrokInput = Static<typeof tilthGrokSchema>;
export type TilthSearchMode = NonNullable<TilthSearchInput["mode"]>;

export interface TilthToolDetails {
  command: string;
  args: string[];
  cwd: string;
  code: number;
  killed: boolean;
  stderr?: string;
}

export interface TilthToolResult {
  content: [{ type: "text"; text: string }];
  details: TilthToolDetails;
  isError?: boolean;
}

export type TilthExec = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

function buildScopeArgs(cwd: string, scope: string | undefined): string[] {
  if (scope === undefined || scope.trim().length === 0) {
    return [];
  }

  return ["--scope", path.resolve(cwd, scope)];
}

function buildBudgetArgs(budget: number | undefined): string[] {
  if (budget === undefined) {
    return [];
  }
  return ["--budget", String(budget)];
}

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRegexMetacharacters(text: string): boolean {
  return REGEX_METACHAR_PATTERN.test(text);
}

function buildLiteralRegexQuery(query: string): string {
  return `/(?:${escapeRegexLiteral(query)})/`;
}

function buildRegexQuery(query: string): string {
  if (query.startsWith("/") && query.endsWith("/") && query.length >= 2) {
    const inner = query.slice(1, -1);
    if (hasRegexMetacharacters(inner)) {
      return query;
    }
    return `/(?:${inner})/`;
  }

  if (hasRegexMetacharacters(query)) {
    return `/${query}/`;
  }

  return `/(?:${query})/`;
}

export function buildReadArgs(params: TilthReadInput, cwd: string): string[] {
  return [
    ...buildScopeArgs(cwd, params.scope),
    ...buildBudgetArgs(params.budget),
    ...(params.section === undefined ? [] : ["--section", params.section]),
    ...(params.full === true ? ["--full"] : []),
    params.path,
  ];
}

export function buildSearchArgs(params: TilthSearchInput, cwd: string): string[] {
  const mode: TilthSearchMode = params.mode ?? "auto";
  const query =
    mode === "literal"
      ? buildLiteralRegexQuery(params.query)
      : mode === "regex"
        ? buildRegexQuery(params.query)
        : params.query;
  const expand = params.full === true ? undefined : (params.expand ?? DEFAULT_SEARCH_EXPAND);

  return [
    ...buildScopeArgs(cwd, params.scope),
    ...buildBudgetArgs(params.budget),
    ...(params.glob === undefined ? [] : ["--glob", params.glob]),
    ...(mode === "callers" ? ["--callers"] : []),
    ...(params.full === true ? ["--full"] : []),
    ...(expand === undefined ? [] : [`--expand=${expand}`]),
    query,
  ];
}

export function buildFilesArgs(params: TilthFilesInput, cwd: string): string[] {
  return [...buildScopeArgs(cwd, params.scope), ...buildBudgetArgs(params.budget), params.pattern];
}

export function buildDepsArgs(params: TilthDepsInput, cwd: string): string[] {
  return [
    ...buildScopeArgs(cwd, params.scope),
    ...buildBudgetArgs(params.budget),
    "--deps",
    params.path,
  ];
}

export function buildGrokArgs(params: TilthGrokInput, cwd: string): string[] {
  return [
    "grok",
    ...buildScopeArgs(cwd, params.scope),
    ...(params.full === true ? ["--full"] : []),
    params.target,
  ];
}

function resolveTilthBinaryPath(): string {
  const packageJsonPath = require.resolve("tilth/package.json");
  const packageDir = path.dirname(packageJsonPath);
  const binaryName = process.platform === "win32" ? "tilth.exe" : "tilth";
  return path.join(packageDir, "bin", binaryName);
}

function buildSuccessText(stdout: string, stderr: string): string {
  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length > 0) {
    return trimmedStdout;
  }

  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return trimmedStderr;
  }

  return "tilth returned no output.";
}

function buildFailureText(details: TilthToolDetails, stdout: string): string {
  const parts = [
    details.killed
      ? "tilth command was interrupted or timed out."
      : `tilth command failed with exit code ${details.code}.`,
  ];

  if (details.stderr !== undefined && details.stderr.length > 0) {
    parts.push(details.stderr);
  }

  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length > 0) {
    parts.push(trimmedStdout);
  }

  return parts.join("\n\n");
}

export async function executeTilthCommand(
  exec: TilthExec,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  const command = resolveTilthBinaryPath();

  try {
    const options: ExecOptions = {
      cwd,
      timeout: DEFAULT_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    };
    const result = await exec(command, args, options);
    const details: TilthToolDetails = {
      command,
      args,
      cwd,
      code: result.code,
      killed: result.killed,
      ...(result.stderr.trim().length === 0 ? {} : { stderr: result.stderr.trim() }),
    };

    if (result.code !== 0 || result.killed) {
      return {
        content: [{ type: "text", text: buildFailureText(details, result.stdout) }],
        details,
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: buildSuccessText(result.stdout, result.stderr) }],
      details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `tilth command failed: ${message}` }],
      details: {
        command,
        args,
        cwd,
        code: -1,
        killed: signal?.aborted ?? false,
      },
      isError: true,
    };
  }
}

export async function executeTilthRead(
  exec: TilthExec,
  params: TilthReadInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  return executeTilthCommand(exec, buildReadArgs(params, cwd), cwd, signal);
}

export async function executeTilthSearch(
  exec: TilthExec,
  params: TilthSearchInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  return executeTilthCommand(exec, buildSearchArgs(params, cwd), cwd, signal);
}

export async function executeTilthFiles(
  exec: TilthExec,
  params: TilthFilesInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  return executeTilthCommand(exec, buildFilesArgs(params, cwd), cwd, signal);
}

export async function executeTilthDeps(
  exec: TilthExec,
  params: TilthDepsInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  return executeTilthCommand(exec, buildDepsArgs(params, cwd), cwd, signal);
}

export async function executeTilthGrok(
  exec: TilthExec,
  params: TilthGrokInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  return executeTilthCommand(exec, buildGrokArgs(params, cwd), cwd, signal);
}
