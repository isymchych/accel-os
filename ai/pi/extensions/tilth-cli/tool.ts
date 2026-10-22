import { createRequire } from "node:module";
import path from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const require = createRequire(import.meta.url);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_READ_BUDGET = 12_000;
const DEFAULT_SEARCH_BUDGET = 10_000;
const DEFAULT_LIST_BUDGET = 8_000;
const DEFAULT_DEPS_BUDGET = 12_000;
const DEFAULT_DIFF_BUDGET = 10_000;
const MAX_BUDGET = 15_000;
const DEFAULT_SEARCH_EXPAND = 2;
const MAX_SEARCH_EXPAND = 5;
const MAX_DIFF_EXPAND = 5;
const REGEX_METACHAR_PATTERN = /[()[\]{}*+?|\\^$]/;

export const tilthToolNames = [
  "tilth_read",
  "tilth_search",
  "tilth_list",
  "tilth_deps",
  "tilth_grok",
  "tilth_diff",
] as const;

export const tilthReadSchema = Type.Object(
  {
    path: Type.String({
      description: "File path to read.",
    }),
    scope: Type.Optional(
      Type.String({
        description:
          "Optional existing directory to resolve relative paths against, including an absolute path to another repository or checkout.",
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
      Type.Integer({
        minimum: 1,
        description:
          "Rare override. Omit by default; tilth_read applies a small budget. Large values directly increase conversation context.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const tilthSearchSchema = Type.Object(
  {
    query: Type.String({
      description:
        "Symbol, concept, exact text, or regex to search for. Callers mode accepts up to five comma-separated symbols.",
    }),
    mode: Type.Optional(
      StringEnum(["auto", "literal", "regex", "callers"] as const, {
        description:
          "Search mode. auto lets Tilth classify the query, literal forces exact text search, regex forces regex search, callers finds call sites for one symbol or up to five comma-separated symbols.",
      }),
    ),
    scope: Type.Optional(
      Type.String({
        description:
          "Optional existing directory to search within, including an absolute path to another repository or checkout. Use glob to filter files.",
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
      Type.Integer({
        minimum: 1,
        description:
          "Rare override. Omit by default; tilth_search applies a small budget. Large values directly increase conversation context.",
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

export const tilthListSchema = Type.Object(
  {
    pattern: Type.String({
      description: "Glob pattern to list, for example '*.ts' or 'src/**/*.rs'.",
    }),
    scope: Type.Optional(
      Type.String({
        description: "Optional existing directory to list within. Use pattern to filter files.",
      }),
    ),
    budget: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Rare override. Omit by default; tilth_files applies a small budget. Large values directly increase conversation context.",
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
        description:
          "Optional existing directory to search for dependents within, including an absolute path to another repository or checkout. Use path for the file to analyze.",
      }),
    ),
    budget: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Rare override. Omit by default; tilth_deps applies a small budget. Large values directly increase conversation context.",
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
        description:
          "Optional existing directory to narrow the search within, including an absolute path to another repository or checkout. Use target to select a symbol or path:line.",
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

export const tilthDiffSchema = Type.Object(
  {
    repository: Type.Optional(
      Type.String({
        description:
          "Repository or checkout directory to inspect. Defaults to the current repository; relative paths resolve from it.",
      }),
    ),
    source: Type.Optional(
      Type.String({
        description:
          "Diff source: uncommitted (default), staged, or a git ref such as HEAD~1 or main..feat. Cannot be combined with file-pair, patch, or log mode.",
      }),
    ),
    scope: Type.Optional(
      Type.String({
        description:
          "Restrict diff output to a repository-relative changed file, optionally followed by :function. Directory scopes are not supported.",
      }),
    ),
    a: Type.Optional(
      Type.String({
        description: "First file for a file-to-file diff. Must be used together with b.",
      }),
    ),
    b: Type.Optional(
      Type.String({
        description: "Second file for a file-to-file diff. Must be used together with a.",
      }),
    ),
    patch: Type.Optional(
      Type.String({
        description: "Path to a patch file to parse instead of running git diff.",
      }),
    ),
    log: Type.Optional(
      Type.String({
        description: "Git log range such as HEAD~5..HEAD for per-commit structural summaries.",
      }),
    ),
    search: Type.Optional(
      Type.String({
        description: "Filter output to symbols or files matching this substring.",
      }),
    ),
    blast: Type.Optional(
      Type.Boolean({
        description: "Show blast-radius warnings for signature-changed symbols.",
      }),
    ),
    expand: Type.Optional(
      Type.Number({
        description: "Number of changed symbols to expand with source context.",
      }),
    ),
    budget: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Rare override. Omit by default; tilth_diff applies a bounded budget. Large values directly increase conversation context.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type TilthReadInput = Static<typeof tilthReadSchema>;
export type TilthSearchInput = Static<typeof tilthSearchSchema>;
export type TilthListInput = Static<typeof tilthListSchema>;
export type TilthDepsInput = Static<typeof tilthDepsSchema>;
export type TilthGrokInput = Static<typeof tilthGrokSchema>;
export type TilthDiffInput = Static<typeof tilthDiffSchema>;
export type TilthSearchMode = NonNullable<TilthSearchInput["mode"]>;

export interface PreparedTilthInput<Input> {
  input: Input;
  warnings: string[];
}

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

function buildDiffScopeArgs(scope: string | undefined): string[] {
  if (scope === undefined || scope.trim().length === 0) {
    return [];
  }

  return ["--scope", scope];
}

function buildBudgetArgs(budget: number | undefined): string[] {
  if (budget === undefined) {
    return [];
  }
  return ["--budget", String(budget)];
}

function clampBudget(
  budget: number | undefined,
  defaultBudget: number,
  toolName: string,
  warnings: string[],
): number {
  const requestedBudget = budget ?? defaultBudget;
  if (requestedBudget < 1) {
    warnings.push(`${toolName} budget clamped from ${requestedBudget} to 1.`);
    return 1;
  }
  if (requestedBudget <= MAX_BUDGET) {
    return requestedBudget;
  }

  warnings.push(
    `${toolName} budget clamped from ${requestedBudget} to ${MAX_BUDGET}; use section, scope, glob, or a narrower query instead of large budgets.`,
  );
  return MAX_BUDGET;
}

function clampSearchExpand(expand: number | undefined, warnings: string[]): number | undefined {
  if (expand === undefined || expand <= MAX_SEARCH_EXPAND) {
    return expand;
  }

  warnings.push(
    `tilth_search expand clamped from ${expand} to ${MAX_SEARCH_EXPAND}; read more matches only after the first result set is insufficient.`,
  );
  return MAX_SEARCH_EXPAND;
}

function clampDiffExpand(expand: number | undefined, warnings: string[]): number | undefined {
  if (expand === undefined || expand <= MAX_DIFF_EXPAND) {
    return expand;
  }

  warnings.push(
    `tilth_diff expand clamped from ${expand} to ${MAX_DIFF_EXPAND}; inspect the summary before expanding more changed symbols.`,
  );
  return MAX_DIFF_EXPAND;
}

export function prepareTilthReadInput(params: TilthReadInput): PreparedTilthInput<TilthReadInput> {
  const warnings: string[] = [];
  return {
    input: {
      ...params,
      budget: clampBudget(params.budget, DEFAULT_READ_BUDGET, "tilth_read", warnings),
    },
    warnings,
  };
}

export function prepareTilthSearchInput(
  params: TilthSearchInput,
): PreparedTilthInput<TilthSearchInput> {
  const warnings: string[] = [];
  const input: TilthSearchInput = {
    ...params,
    budget: clampBudget(params.budget, DEFAULT_SEARCH_BUDGET, "tilth_search", warnings),
  };
  const expand = params.full === true ? undefined : clampSearchExpand(params.expand, warnings);
  if (expand !== undefined) {
    input.expand = expand;
  }

  return {
    input,
    warnings,
  };
}

export function prepareTilthListInput(params: TilthListInput): PreparedTilthInput<TilthListInput> {
  const warnings: string[] = [];
  return {
    input: {
      ...params,
      budget: clampBudget(params.budget, DEFAULT_LIST_BUDGET, "tilth_list", warnings),
    },
    warnings,
  };
}

export function prepareTilthDepsInput(params: TilthDepsInput): PreparedTilthInput<TilthDepsInput> {
  const warnings: string[] = [];
  return {
    input: {
      ...params,
      budget: clampBudget(params.budget, DEFAULT_DEPS_BUDGET, "tilth_deps", warnings),
    },
    warnings,
  };
}

export function prepareTilthDiffInput(params: TilthDiffInput): PreparedTilthInput<TilthDiffInput> {
  const warnings: string[] = [];
  const hasFilePair = params.a !== undefined || params.b !== undefined;
  if ((params.a === undefined) !== (params.b === undefined)) {
    throw new Error("tilth_diff requires a and b together");
  }

  const selectedModes = [
    ...(params.source === undefined ? [] : ["source"]),
    ...(hasFilePair ? ["file pair"] : []),
    ...(params.patch === undefined ? [] : ["patch"]),
    ...(params.log === undefined ? [] : ["log"]),
  ];
  if (selectedModes.length > 1) {
    throw new Error(`tilth_diff modes are mutually exclusive: ${selectedModes.join(", ")}`);
  }
  if (params.source?.startsWith("-") === true) {
    throw new Error("tilth_diff source must not start with '-'");
  }

  const input: TilthDiffInput = {
    ...params,
    budget: clampBudget(params.budget, DEFAULT_DIFF_BUDGET, "tilth_diff", warnings),
  };
  const expand = clampDiffExpand(params.expand, warnings);
  if (expand !== undefined) {
    input.expand = expand;
  }

  return {
    input,
    warnings,
  };
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
  const { input } = prepareTilthReadInput(params);
  return [
    ...buildScopeArgs(cwd, input.scope),
    ...buildBudgetArgs(input.budget),
    ...(input.section === undefined ? [] : ["--section", input.section]),
    ...(input.full === true ? ["--full"] : []),
    input.path,
  ];
}

export function buildSearchArgs(params: TilthSearchInput, cwd: string): string[] {
  const { input } = prepareTilthSearchInput(params);
  const mode: TilthSearchMode = input.mode ?? "auto";
  const query =
    mode === "literal"
      ? buildLiteralRegexQuery(input.query)
      : mode === "regex"
        ? buildRegexQuery(input.query)
        : input.query;
  const expand = input.full === true ? undefined : (input.expand ?? DEFAULT_SEARCH_EXPAND);

  return [
    ...buildScopeArgs(cwd, input.scope),
    ...buildBudgetArgs(input.budget),
    ...(input.glob === undefined ? [] : ["--glob", input.glob]),
    ...(mode === "callers" ? ["--callers"] : []),
    ...(input.full === true ? ["--full"] : []),
    ...(expand === undefined ? [] : [`--expand=${expand}`]),
    query,
  ];
}

export function buildListArgs(params: TilthListInput, cwd: string): string[] {
  const { input } = prepareTilthListInput(params);
  return [...buildScopeArgs(cwd, input.scope), ...buildBudgetArgs(input.budget), input.pattern];
}

export function buildDepsArgs(params: TilthDepsInput, cwd: string): string[] {
  const { input } = prepareTilthDepsInput(params);
  return [
    ...buildScopeArgs(cwd, input.scope),
    ...buildBudgetArgs(input.budget),
    "--deps",
    input.path,
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

export function buildDiffArgs(params: TilthDiffInput, _cwd: string): string[] {
  const { input } = prepareTilthDiffInput(params);

  return [
    "diff",
    input.source ?? "uncommitted",
    ...buildDiffScopeArgs(input.scope),
    ...(input.a === undefined ? [] : ["--a", input.a]),
    ...(input.b === undefined ? [] : ["--b", input.b]),
    ...(input.patch === undefined ? [] : ["--patch", input.patch]),
    ...(input.log === undefined ? [] : ["--log", input.log]),
    ...(input.search === undefined ? [] : ["--search", input.search]),
    ...(input.blast === true ? ["--blast"] : []),
    ...(input.expand === undefined ? [] : ["--expand", String(input.expand)]),
    ...buildBudgetArgs(input.budget),
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
  let result: ExecResult;

  try {
    const options: ExecOptions = {
      cwd,
      timeout: DEFAULT_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    };
    result = await exec(command, args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`tilth command failed: ${message}`, { cause: error });
  }

  const details: TilthToolDetails = {
    command,
    args,
    cwd,
    code: result.code,
    killed: result.killed,
    ...(result.stderr.trim().length === 0 ? {} : { stderr: result.stderr.trim() }),
  };
  if (result.code !== 0 || result.killed) {
    throw new Error(buildFailureText(details, result.stdout));
  }

  return {
    content: [{ type: "text", text: buildSuccessText(result.stdout, result.stderr) }],
    details,
  };
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

export async function executeTilthList(
  exec: TilthExec,
  params: TilthListInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  return executeTilthCommand(exec, buildListArgs(params, cwd), cwd, signal);
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

export async function executeTilthDiff(
  exec: TilthExec,
  params: TilthDiffInput,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<TilthToolResult> {
  const repository = params.repository === undefined ? cwd : path.resolve(cwd, params.repository);
  const args = buildDiffArgs(params, repository);
  const source = params.source;
  const usesGitRef =
    source !== undefined && source !== "uncommitted" && source !== "working" && source !== "staged";

  if (usesGitRef) {
    let validation: ExecResult;
    try {
      validation = await exec(
        "git",
        [
          "diff",
          "--quiet",
          "--no-ext-diff",
          source,
          "--",
          ...(params.scope === undefined ? [] : [params.scope]),
        ],
        {
          cwd: repository,
          timeout: DEFAULT_TIMEOUT_MS,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`tilth_diff could not validate source '${source}': ${message}`, {
        cause: error,
      });
    }

    if (validation.killed || (validation.code !== 0 && validation.code !== 1)) {
      const output = validation.stderr.trim() || validation.stdout.trim();
      const reason = validation.killed
        ? "validation was interrupted or timed out"
        : `git diff exited with code ${validation.code}`;
      throw new Error(
        `tilth_diff source '${source}' is invalid: ${reason}${output.length === 0 ? "" : `\n\n${output}`}`,
      );
    }
  }

  return executeTilthCommand(exec, args, repository, signal);
}
