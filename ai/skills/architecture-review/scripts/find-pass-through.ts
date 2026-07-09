import { readFile } from "node:fs/promises";

import { runGit } from "../../lib/git_command.ts";

type Mode = { kind: "workspace" } | { kind: "staged" } | { kind: "base"; baseRef: string };

type Finding = {
  file: string;
  line: number;
  wrapperName: string;
  delegateCall: string;
};

const selectedMode = parseMode(process.argv.slice(2));
const files = await getChangedFiles(selectedMode);

if (files.length === 0) {
  console.log("No changed files.");
  process.exit(0);
}

const candidateFiles = files.filter(
  (file) =>
    file.endsWith(".ts") ||
    file.endsWith(".tsx") ||
    file.endsWith(".js") ||
    file.endsWith(".jsx") ||
    file.endsWith(".rs"),
);

const detectedFindings: Finding[] = [];
for (const file of candidateFiles) {
  const fileFindings = await scanFile(file);
  detectedFindings.push(...fileFindings);
}

if (detectedFindings.length === 0) {
  console.log("No likely pass-through wrappers found in changed files.");
  process.exit(0);
}

console.log("Likely pass-through wrappers:");
for (const finding of detectedFindings) {
  console.log(`${finding.file}:${finding.line} ${finding.wrapperName} -> ${finding.delegateCall}`);
}

function parseMode(args: string[]): Mode {
  if (args.length === 0) return { kind: "workspace" };
  if (args.length === 1 && args[0] === "--staged") return { kind: "staged" };
  const baseRef = args[1];
  if (args.length === 2 && args[0] === "--base" && baseRef !== undefined && baseRef !== "") {
    return { kind: "base", baseRef };
  }
  return usage();
}

function usage(): never {
  console.error("ERR_USAGE: expected no args, --staged, or --base <ref>");
  process.exit(64);
}

async function getChangedFiles(requestedMode: Mode): Promise<string[]> {
  const shared = ["diff", "--name-only", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"];
  const diffArgs =
    requestedMode.kind === "workspace"
      ? [...shared, "HEAD"]
      : requestedMode.kind === "staged"
        ? [...shared, "--staged"]
        : [...shared, `${requestedMode.baseRef}...HEAD`];

  const result = await runGit(diffArgs);
  if (!result.success) {
    const errorText = result.stderr || result.stdout || `git exited with status ${result.code}`;
    if (/not a git repository/i.test(errorText)) {
      console.error(`ERR_NOT_REPO: ${errorText}`);
      process.exit(65);
    }
    console.error(`ERR_GIT: ${errorText}`);
    process.exit(66);
  }

  if (result.stdout === "") return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

async function scanFile(path: string): Promise<Finding[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  if (path.endsWith(".rs")) return findRustPassThrough(path, text);
  return findTsJsPassThrough(path, text);
}

function findTsJsPassThrough(path: string, text: string): Finding[] {
  const collectedFindings: Finding[] = [];

  const functionRe =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{\s*return\s+([A-Za-z_$][A-Za-z0-9_$.]*)\(([^)]*)\);?\s*\}/g;

  const arrowRe =
    /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*([A-Za-z_$][A-Za-z0-9_$.]*)\(([^)]*)\);?/g;

  for (const match of text.matchAll(functionRe)) {
    const finding = toTsJsFinding(path, text, match);
    if (finding) collectedFindings.push(finding);
  }
  for (const match of text.matchAll(arrowRe)) {
    const finding = toTsJsFinding(path, text, match);
    if (finding) collectedFindings.push(finding);
  }

  return collectedFindings;
}

function toTsJsFinding(path: string, text: string, match: RegExpMatchArray): Finding | null {
  const wrapperName = match[1];
  const rawWrapperParams = match[2];
  const delegateCall = match[3];
  const rawDelegateArgs = match[4];

  if (
    wrapperName === undefined ||
    rawWrapperParams === undefined ||
    delegateCall === undefined ||
    rawDelegateArgs === undefined
  )
    return null;

  const wrapperParams = parseTsParams(rawWrapperParams);
  const delegateArgs = parseCallArgs(rawDelegateArgs);

  if (wrapperName === delegateCall) return null;
  if (!sameArgs(wrapperParams, delegateArgs)) return null;

  const line = getLineNumber(text, match.index ?? 0);
  return { file: path, line, wrapperName, delegateCall };
}

function findRustPassThrough(path: string, text: string): Finding[] {
  const collectedFindings: Finding[] = [];
  const fnRe =
    /(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^{]+)?\{\s*(?:return\s+)?([A-Za-z_][A-Za-z0-9_:]*)\(([^)]*)\);?\s*\}/g;

  for (const match of text.matchAll(fnRe)) {
    const wrapperName = match[1];
    const delegateCall = match[3];
    const rawWrapperParams = match[2];
    const rawDelegateArgs = match[4];

    if (
      wrapperName === undefined ||
      rawWrapperParams === undefined ||
      delegateCall === undefined ||
      rawDelegateArgs === undefined
    )
      continue;

    const wrapperParams = parseRustParams(rawWrapperParams);
    const delegateArgs = parseCallArgs(rawDelegateArgs);

    if (wrapperName === delegateCall) continue;
    if (!sameArgs(wrapperParams, delegateArgs)) continue;

    const line = getLineNumber(text, match.index);
    collectedFindings.push({ file: path, line, wrapperName, delegateCall });
  }

  return collectedFindings;
}

function parseTsParams(rawParams: string): string[] {
  return rawParams
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => entry.replace(/^\.{3}/, ""))
    .map((entry) => entry.replace(/\?.*$/, ""))
    .map((entry) => entry.replace(/:.+$/, ""))
    .map((entry) => entry.replace(/\s*=.+$/, ""))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function parseRustParams(rawParams: string): string[] {
  return rawParams
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => entry.replace(/^mut\s+/, ""))
    .map((entry) => entry.split(":")[0]?.trim() ?? "")
    .filter((entry) => entry !== "");
}

function parseCallArgs(rawArgs: string): string[] {
  return rawArgs
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => entry.replace(/^\.{3}/, ""))
    .filter((entry) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry));
}

function sameArgs(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function getLineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}
