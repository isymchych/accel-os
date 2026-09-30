import { parseArgs } from "node:util";

export type ReviewMode =
  | { kind: "workspace" }
  | { kind: "staged" }
  | { kind: "base"; baseRef: string };

const cliOptions = {
  base: { type: "string" },
  staged: { type: "boolean" },
} as const;

type CliArgsConfig = {
  args: string[];
  allowPositionals: true;
  options: typeof cliOptions;
};

export function parseReviewMode(args: string[]): ReviewMode {
  const parsed = parseCliArgs(args);
  if (parsed.positionals.length > 0) return usage();
  if (parsed.values.staged === true && parsed.values.base !== undefined) return usage();
  if (parsed.values.staged === true) return { kind: "staged" };
  if (parsed.values.base !== undefined && parsed.values.base !== "") {
    return { kind: "base", baseRef: parsed.values.base };
  }
  if (parsed.values.base === "") return usage();
  return { kind: "workspace" };
}

function parseCliArgs(args: string[]): ReturnType<typeof parseArgs<CliArgsConfig>> {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: cliOptions,
    });
  } catch {
    return usage();
  }
}

function usage(): never {
  console.error("ERR_USAGE: expected no args, --staged, or --base <ref>");
  process.exit(64);
}
