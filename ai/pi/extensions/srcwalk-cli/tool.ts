import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExecOptions,
  type ExecResult,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const require = createRequire(import.meta.url);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BUDGET = 6_000;
const MAX_BUDGET = 15_000;
const MAX_EXPAND = 5;
const MAX_DEPTH = 5;

const scopeSchema = Type.Optional(
  Type.String({
    description:
      "Optional subdirectory, or an absolute path to another repository or checkout, to inspect.",
  }),
);
const budgetSchema = Type.Optional(
  Type.Integer({
    minimum: 1,
    description:
      "Maximum approximate tokens returned by srcwalk. Defaults to 6000 and is capped at 15000.",
  }),
);
const artifactSchema = Type.Optional(
  Type.Boolean({
    description: "Include JavaScript/TypeScript build artifacts as artifact-level evidence.",
  }),
);
const paginationProperties = {
  limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum results." })),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "Number of results to skip." })),
};

export const srcwalkReadSchema = Type.Object(
  {
    target: Type.String({
      description:
        "Exact file path, path:line, path:start-end, path:symbol, or comma-separated exact locations.",
    }),
    scope: scopeSchema,
    section: Type.Optional(
      Type.String({
        description: "Line, line range, heading, symbol, or comma-separated sections.",
      }),
    ),
    context_lines: Type.Optional(
      Type.Integer({ minimum: 0, description: "Extra lines before and after focused evidence." }),
    ),
    full: Type.Optional(
      Type.Boolean({ description: "Show the explicit raw first page, subject to srcwalk caps." }),
    ),
    artifact: artifactSchema,
    budget: budgetSchema,
  },
  { additionalProperties: false },
);

export const srcwalkDiscoverSchema = Type.Object(
  {
    query: Type.String({
      description:
        "Symbol, 2-5 comma-separated symbols, field/member, text, path fragment, or file glob.",
    }),
    kind: Type.Optional(
      StringEnum(["symbol", "file", "text", "access"] as const, {
        description: "Force symbol, file, text, or field/member-access discovery.",
      }),
    ),
    match: Type.Optional(
      StringEnum(["any", "all"] as const, {
        description:
          "Match any comma-separated term or require same-file co-occurrence of all terms.",
      }),
    ),
    scopes: Type.Optional(
      Type.Array(Type.String(), {
        minItems: 1,
        description:
          "Search roots. Multiple roots are supported only for symbol discovery; other modes require one.",
      }),
    ),
    expand: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Expand source context for the top N matches; capped at 5.",
      }),
    ),
    exclude: Type.Optional(Type.String({ description: "Exclude matching files from evidence." })),
    filter: Type.Optional(
      Type.String({ description: "Filter results using srcwalk field:value qualifiers." }),
    ),
    artifact: artifactSchema,
    budget: budgetSchema,
    ...paginationProperties,
  },
  { additionalProperties: false },
);

export const srcwalkContextSchema = Type.Object(
  {
    target: Type.String({
      description:
        "Known symbol, file:symbol, file:line, file:start-end, or up to three comma-separated exact path targets.",
    }),
    scope: scopeSchema,
    depth: Type.Optional(
      Type.Integer({ minimum: 1, description: "Depth of the compact context slice; capped at 5." }),
    ),
    filter: Type.Optional(
      Type.String({ description: "Filter context facts using srcwalk field:value qualifiers." }),
    ),
    artifact: artifactSchema,
    budget: budgetSchema,
  },
  { additionalProperties: false },
);

export const srcwalkCallersSchema = Type.Object(
  {
    target: Type.String({ description: "Known symbol or exact path:symbol target." }),
    scope: scopeSchema,
    expand: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Expand source context for top callers; capped at 5.",
      }),
    ),
    filter: Type.Optional(
      Type.String({ description: "Filter direct call sites using field:value qualifiers." }),
    ),
    count_by: Type.Optional(
      StringEnum(["args", "caller", "receiver", "path", "file"] as const, {
        description: "Count direct call sites by field.",
      }),
    ),
    depth: Type.Optional(
      Type.Integer({ minimum: 1, description: "Transitive caller BFS depth; capped at 5." }),
    ),
    max_frontier: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum callers expanded per BFS hop." }),
    ),
    max_edges: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum total edges across BFS hops." }),
    ),
    skip_hubs: Type.Optional(
      Type.String({ description: "Comma-separated symbols excluded as BFS frontier hubs." }),
    ),
    artifact: artifactSchema,
    budget: budgetSchema,
    ...paginationProperties,
  },
  { additionalProperties: false },
);

export const srcwalkCalleesSchema = Type.Object(
  {
    target: Type.String({ description: "Known symbol or exact path:symbol target." }),
    scope: scopeSchema,
    detailed: Type.Optional(
      Type.Boolean({
        description: "Show ordered call sites with arguments and assignment context.",
      }),
    ),
    depth: Type.Optional(
      Type.Integer({ minimum: 1, description: "Callee traversal depth; capped at 5." }),
    ),
    filter: Type.Optional(
      Type.String({ description: "Filter detailed call sites using field:value qualifiers." }),
    ),
    artifact: artifactSchema,
    budget: budgetSchema,
  },
  { additionalProperties: false },
);

export const srcwalkDepsSchema = Type.Object(
  {
    path: Type.String({ description: "File whose imports and dependents should be analyzed." }),
    scope: scopeSchema,
    artifact: artifactSchema,
    budget: budgetSchema,
    ...paginationProperties,
  },
  { additionalProperties: false },
);

export const srcwalkOverviewSchema = Type.Object(
  {
    scope: scopeSchema,
    depth: Type.Optional(Type.Integer({ minimum: 1, description: "Overview tree depth." })),
    symbols: Type.Optional(Type.Boolean({ description: "Include symbol names in the overview." })),
    artifact: artifactSchema,
  },
  { additionalProperties: false },
);

export const srcwalkAssessSchema = Type.Object(
  {
    target: Type.String({ description: "Known symbol to assess for heuristic blast radius." }),
    scope: scopeSchema,
    artifact: artifactSchema,
    budget: budgetSchema,
  },
  { additionalProperties: false },
);

export const srcwalkCompareSchema = Type.Object(
  {
    target_a: Type.String({ description: "First known function or line target." }),
    target_b: Type.String({ description: "Second known function or line target." }),
    scope: scopeSchema,
    artifact: artifactSchema,
    budget: budgetSchema,
  },
  { additionalProperties: false },
);

export const srcwalkReviewSchema = Type.Object(
  {
    target: Type.Optional(
      Type.String({
        description: "Known function/line target or explicit Git revision range.",
      }),
    ),
    repository: Type.Optional(
      Type.String({
        description: "Repository or checkout directory. Defaults to the current working directory.",
      }),
    ),
    scope: Type.Optional(
      Type.String({ description: "Optional path within the selected repository to review." }),
    ),
    staged: Type.Optional(Type.Boolean({ description: "Review staged changes only." })),
    artifact: artifactSchema,
    budget: budgetSchema,
    ...paginationProperties,
  },
  { additionalProperties: false },
);

export type SrcwalkReadInput = Static<typeof srcwalkReadSchema>;
export type SrcwalkDiscoverInput = Static<typeof srcwalkDiscoverSchema>;
export type SrcwalkContextInput = Static<typeof srcwalkContextSchema>;
export type SrcwalkCallersInput = Static<typeof srcwalkCallersSchema>;
export type SrcwalkCalleesInput = Static<typeof srcwalkCalleesSchema>;
export type SrcwalkDepsInput = Static<typeof srcwalkDepsSchema>;
export type SrcwalkOverviewInput = Static<typeof srcwalkOverviewSchema>;
export type SrcwalkAssessInput = Static<typeof srcwalkAssessSchema>;
export type SrcwalkCompareInput = Static<typeof srcwalkCompareSchema>;
export type SrcwalkReviewInput = Static<typeof srcwalkReviewSchema>;

export const srcwalkToolNames = [
  "srcwalk_read",
  "srcwalk_discover",
  "srcwalk_context",
  "srcwalk_callers",
  "srcwalk_callees",
  "srcwalk_deps",
  "srcwalk_overview",
  "srcwalk_assess",
  "srcwalk_compare",
  "srcwalk_review",
] as const;

export interface SrcwalkToolDetails {
  command: string;
  args: string[];
  cwd: string;
  code: number;
  killed: boolean;
  truncated: boolean;
  warnings: string[];
  stderr?: string;
}

export interface SrcwalkToolResult {
  content: [{ type: "text"; text: string }];
  details: SrcwalkToolDetails;
}

export type SrcwalkExec = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

interface PreparedNumber {
  value: number | undefined;
  warning?: string;
}

function clampNumber(value: number | undefined, maximum: number, label: string): PreparedNumber {
  if (value === undefined || value <= maximum) {
    return { value };
  }
  return { value: maximum, warning: `${label} clamped from ${value} to ${maximum}.` };
}

function prepareBudget(value: number | undefined): PreparedNumber {
  return clampNumber(value ?? DEFAULT_BUDGET, MAX_BUDGET, "srcwalk budget");
}

function expandUserPath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function normalizePathArgument(value: string): string {
  const withoutAt = value.startsWith("@") ? value.slice(1) : value;
  return expandUserPath(withoutAt);
}

function resolveScope(cwd: string, scope: string): string {
  return path.resolve(cwd, normalizePathArgument(scope));
}

function buildScopeArgs(cwd: string, scope: string | undefined): string[] {
  return scope === undefined || scope.trim().length === 0
    ? []
    : ["--scope", resolveScope(cwd, scope)];
}

function buildCommonArgs(
  cwd: string,
  input: { scope?: string; artifact?: boolean; budget?: number },
  warnings: string[],
): string[] {
  const budget = prepareBudget(input.budget);
  if (budget.warning !== undefined) {
    warnings.push(budget.warning);
  }
  return [
    ...buildScopeArgs(cwd, input.scope),
    ...(input.artifact === true ? ["--artifact"] : []),
    "--budget",
    String(budget.value),
  ];
}

function buildPaginationArgs(input: { limit?: number; offset?: number }): string[] {
  return [
    ...(input.limit === undefined ? [] : ["--limit", String(input.limit)]),
    ...(input.offset === undefined || input.offset === 0 ? [] : ["--offset", String(input.offset)]),
  ];
}

export interface BuiltSrcwalkCommand {
  args: string[];
  warnings: string[];
  cwd?: string;
}

export function buildReadCommand(input: SrcwalkReadInput, cwd: string): BuiltSrcwalkCommand {
  const warnings: string[] = [];
  return {
    args: [
      "show",
      normalizePathArgument(input.target),
      ...buildCommonArgs(cwd, input, warnings),
      ...(input.section === undefined ? [] : ["--section", input.section]),
      ...(input.context_lines === undefined
        ? []
        : ["--context-lines", String(input.context_lines)]),
      ...(input.full === true ? ["--full"] : []),
    ],
    warnings,
  };
}

export function buildDiscoverCommand(
  input: SrcwalkDiscoverInput,
  cwd: string,
): BuiltSrcwalkCommand {
  const warnings: string[] = [];
  const scopes = input.scopes ?? [];
  if (scopes.length > 1 && input.kind !== "symbol") {
    throw new Error("srcwalk_discover accepts multiple scopes only when kind is 'symbol'");
  }
  const expand = clampNumber(input.expand, MAX_EXPAND, "srcwalk_discover expand");
  if (expand.warning !== undefined) {
    warnings.push(expand.warning);
  }
  const common = buildCommonArgs(
    cwd,
    {
      ...(input.artifact === undefined ? {} : { artifact: input.artifact }),
      ...(input.budget === undefined ? {} : { budget: input.budget }),
    },
    warnings,
  );
  return {
    args: [
      "discover",
      input.query,
      ...scopes.flatMap((scope) => ["--scope", resolveScope(cwd, scope)]),
      ...common,
      ...(input.kind === undefined ? [] : ["--as", input.kind]),
      ...(input.match === undefined ? [] : ["--match", input.match]),
      ...(expand.value === undefined ? [] : [`--expand=${expand.value}`]),
      ...(input.exclude === undefined ? [] : ["--exclude", input.exclude]),
      ...(input.filter === undefined ? [] : ["--filter", input.filter]),
      ...buildPaginationArgs(input),
    ],
    warnings,
  };
}

export function buildContextCommand(input: SrcwalkContextInput, cwd: string): BuiltSrcwalkCommand {
  const warnings: string[] = [];
  const depth = clampNumber(input.depth, MAX_DEPTH, "srcwalk_context depth");
  if (depth.warning !== undefined) {
    warnings.push(depth.warning);
  }
  return {
    args: [
      "context",
      input.target,
      ...buildCommonArgs(cwd, input, warnings),
      ...(depth.value === undefined ? [] : ["--depth", String(depth.value)]),
      ...(input.filter === undefined ? [] : ["--filter", input.filter]),
    ],
    warnings,
  };
}

export function buildCallersCommand(input: SrcwalkCallersInput, cwd: string): BuiltSrcwalkCommand {
  if ((input.filter !== undefined || input.count_by !== undefined) && (input.depth ?? 1) >= 2) {
    throw new Error("srcwalk_callers filter and count_by apply only to direct callers; omit depth");
  }
  const warnings: string[] = [];
  const expand = clampNumber(input.expand, MAX_EXPAND, "srcwalk_callers expand");
  const depth = clampNumber(input.depth, MAX_DEPTH, "srcwalk_callers depth");
  for (const prepared of [expand, depth]) {
    if (prepared.warning !== undefined) {
      warnings.push(prepared.warning);
    }
  }
  return {
    args: [
      "trace",
      "callers",
      input.target,
      ...buildCommonArgs(cwd, input, warnings),
      ...(expand.value === undefined ? [] : [`--expand=${expand.value}`]),
      ...(input.filter === undefined ? [] : ["--filter", input.filter]),
      ...(input.count_by === undefined ? [] : ["--count-by", input.count_by]),
      ...(depth.value === undefined ? [] : ["--depth", String(depth.value)]),
      ...(input.max_frontier === undefined ? [] : ["--max-frontier", String(input.max_frontier)]),
      ...(input.max_edges === undefined ? [] : ["--max-edges", String(input.max_edges)]),
      ...(input.skip_hubs === undefined ? [] : ["--skip-hubs", input.skip_hubs]),
      ...buildPaginationArgs(input),
    ],
    warnings,
  };
}

export function buildCalleesCommand(input: SrcwalkCalleesInput, cwd: string): BuiltSrcwalkCommand {
  if (input.filter !== undefined && input.detailed !== true) {
    throw new Error("srcwalk_callees filter requires detailed=true");
  }
  const warnings: string[] = [];
  const depth = clampNumber(input.depth, MAX_DEPTH, "srcwalk_callees depth");
  if (depth.warning !== undefined) {
    warnings.push(depth.warning);
  }
  return {
    args: [
      "trace",
      "callees",
      input.target,
      ...buildCommonArgs(cwd, input, warnings),
      ...(input.detailed === true ? ["--detailed"] : []),
      ...(depth.value === undefined ? [] : ["--depth", String(depth.value)]),
      ...(input.filter === undefined ? [] : ["--filter", input.filter]),
    ],
    warnings,
  };
}

export function buildDepsCommand(input: SrcwalkDepsInput, cwd: string): BuiltSrcwalkCommand {
  const warnings: string[] = [];
  return {
    args: [
      "deps",
      normalizePathArgument(input.path),
      ...buildCommonArgs(cwd, input, warnings),
      ...buildPaginationArgs(input),
    ],
    warnings,
  };
}

export function buildOverviewCommand(
  input: SrcwalkOverviewInput,
  cwd: string,
): BuiltSrcwalkCommand {
  return {
    args: [
      "overview",
      ...buildScopeArgs(cwd, input.scope),
      ...(input.artifact === true ? ["--artifact"] : []),
      ...(input.depth === undefined ? [] : ["--depth", String(input.depth)]),
      ...(input.symbols === true ? ["--symbols"] : []),
    ],
    warnings: [],
  };
}

export function buildAssessCommand(input: SrcwalkAssessInput, cwd: string): BuiltSrcwalkCommand {
  const warnings: string[] = [];
  return {
    args: ["assess", input.target, ...buildCommonArgs(cwd, input, warnings)],
    warnings,
  };
}

export function buildCompareCommand(input: SrcwalkCompareInput, cwd: string): BuiltSrcwalkCommand {
  const warnings: string[] = [];
  return {
    args: ["compare", input.target_a, input.target_b, ...buildCommonArgs(cwd, input, warnings)],
    warnings,
  };
}

export function buildReviewCommand(input: SrcwalkReviewInput, cwd: string): BuiltSrcwalkCommand {
  if (input.staged === true && input.target !== undefined) {
    throw new Error("srcwalk_review staged mode cannot be combined with target");
  }
  const repository =
    input.repository === undefined
      ? cwd
      : path.resolve(cwd, normalizePathArgument(input.repository));
  const warnings: string[] = [];
  return {
    args: [
      "review",
      ...(input.target === undefined ? [] : [input.target]),
      ...buildCommonArgs(repository, input, warnings),
      ...(input.staged === true ? ["--staged"] : []),
      ...buildPaginationArgs(input),
    ],
    warnings,
    cwd: repository,
  };
}

export function resolveSrcwalkBinaryPath(): string {
  const packageJsonPath = require.resolve("srcwalk/package.json");
  const packageDirectory = path.dirname(packageJsonPath);
  const binaryName = process.platform === "win32" ? "srcwalk.exe" : "srcwalk";
  return path.join(packageDirectory, "bin", binaryName);
}

function buildOutput(
  stdout: string,
  stderr: string,
  warnings: readonly string[],
): {
  text: string;
  truncated: boolean;
} {
  const primary = stdout.trim().length > 0 ? stdout.trimEnd() : stderr.trimEnd();
  const base = primary.length > 0 ? primary : "srcwalk returned no output.";
  const truncation = truncateHead(base, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  const notes = [...warnings];
  if (truncation.truncated) {
    notes.push(
      `Pi truncated srcwalk output to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; narrow the target, scope, filter, limit, or budget.`,
    );
  }
  return {
    text:
      notes.length === 0
        ? truncation.content
        : `${truncation.content}\n\nSrcwalk argument note: ${notes.join(" ")}`,
    truncated: truncation.truncated,
  };
}

function buildFailureText(code: number, killed: boolean, stdout: string, stderr: string): string {
  const parts = [
    killed
      ? "srcwalk command was interrupted or timed out."
      : `srcwalk command failed with exit code ${code}.`,
  ];
  if (stderr.trim().length > 0) {
    parts.push(stderr.trim());
  }
  if (stdout.trim().length > 0) {
    parts.push(stdout.trim());
  }
  return parts.join("\n\n");
}

export async function executeSrcwalkCommand(
  exec: SrcwalkExec,
  built: BuiltSrcwalkCommand,
  defaultCwd: string,
  signal: AbortSignal | undefined,
): Promise<SrcwalkToolResult> {
  let command: string;
  try {
    command = resolveSrcwalkBinaryPath();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `srcwalk is not installed for the Pi workspace; install the pinned dependency before loading this extension: ${message}`,
      { cause: error },
    );
  }

  const executionCwd = built.cwd ?? defaultCwd;
  let result: ExecResult;
  try {
    const options: ExecOptions = {
      cwd: executionCwd,
      timeout: DEFAULT_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    };
    result = await exec(command, built.args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`srcwalk command failed to start: ${message}`, { cause: error });
  }

  if (result.code !== 0 || result.killed) {
    throw new Error(buildFailureText(result.code, result.killed, result.stdout, result.stderr));
  }

  const output = buildOutput(result.stdout, result.stderr, built.warnings);
  return {
    content: [{ type: "text", text: output.text }],
    details: {
      command,
      args: built.args,
      cwd: executionCwd,
      code: result.code,
      killed: result.killed,
      truncated: output.truncated,
      warnings: built.warnings,
      ...(result.stderr.trim().length === 0 ? {} : { stderr: result.stderr.trim() }),
    },
  };
}

export async function executeBuiltSrcwalk(
  exec: SrcwalkExec,
  built: BuiltSrcwalkCommand,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<SrcwalkToolResult> {
  return executeSrcwalkCommand(exec, built, cwd, signal);
}
