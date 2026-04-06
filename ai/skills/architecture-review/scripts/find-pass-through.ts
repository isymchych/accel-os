#!/usr/bin/env -S deno run --quiet --allow-read --allow-run=git

import { runGit } from "../../lib/git_command.ts";

type Mode =
  | { kind: "workspace" }
  | { kind: "staged" }
  | { kind: "base"; baseRef: string };

type Finding = {
  file: string;
  line: number;
  wrapperName: string;
  delegateCall: string;
};

const mode = parseMode(Deno.args);
const files = await getChangedFiles(mode);

if (files.length === 0) {
  console.log("No changed files.");
  Deno.exit(0);
}

const candidateFiles = files.filter((file) =>
  file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".jsx") ||
  file.endsWith(".rs")
);

const findings: Finding[] = [];
for (const file of candidateFiles) {
  const fileFindings = await scanFile(file);
  findings.push(...fileFindings);
}

if (findings.length === 0) {
  console.log("No likely pass-through wrappers found in changed files.");
  Deno.exit(0);
}

console.log("Likely pass-through wrappers:");
for (const finding of findings) {
  console.log(`${finding.file}:${finding.line} ${finding.wrapperName} -> ${finding.delegateCall}`);
}

function parseMode(args: string[]): Mode {
  if (args.length === 0) return { kind: "workspace" };
  if (args.length === 1 && args[0] === "--staged") return { kind: "staged" };
  if (args.length === 2 && args[0] === "--base" && args[1] !== "") {
    return { kind: "base", baseRef: args[1] };
  }
  usage();
}

function usage(): never {
  console.error("ERR_USAGE: expected no args, --staged, or --base <ref>");
  Deno.exit(64);
}

async function getChangedFiles(mode: Mode): Promise<string[]> {
  const shared = ["diff", "--name-only", "--no-color", "--no-ext-diff", "--diff-filter=ACMR"];
  const diffArgs = mode.kind === "workspace"
    ? [...shared, "HEAD"]
    : mode.kind === "staged"
    ? [...shared, "--staged"]
    : [...shared, `${mode.baseRef}...HEAD`];

  const result = await runGit(diffArgs);
  if (!result.success) {
    const errorText = result.stderr || result.stdout || `git exited with status ${result.code}`;
    if (/not a git repository/i.test(errorText)) {
      console.error(`ERR_NOT_REPO: ${errorText}`);
      Deno.exit(65);
    }
    console.error(`ERR_GIT: ${errorText}`);
    Deno.exit(66);
  }

  if (result.stdout === "") return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

async function scanFile(path: string): Promise<Finding[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return [];
  }

  if (path.endsWith(".rs")) return findRustPassThrough(path, text);
  return findTsJsPassThrough(path, text);
}

function findTsJsPassThrough(path: string, text: string): Finding[] {
  const findings: Finding[] = [];

  const functionRe =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{\s*return\s+([A-Za-z_$][A-Za-z0-9_$.]*)\(([^)]*)\);?\s*\}/g;

  const arrowRe =
    /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*([A-Za-z_$][A-Za-z0-9_$.]*)\(([^)]*)\);?/g;

  for (const match of text.matchAll(functionRe)) {
    const finding = toTsJsFinding(path, text, match);
    if (finding) findings.push(finding);
  }
  for (const match of text.matchAll(arrowRe)) {
    const finding = toTsJsFinding(path, text, match);
    if (finding) findings.push(finding);
  }

  return findings;
}

function toTsJsFinding(path: string, text: string, match: RegExpMatchArray): Finding | null {
  const wrapperName = match[1];
  const wrapperParams = parseTsParams(match[2]);
  const delegateCall = match[3];
  const delegateArgs = parseCallArgs(match[4]);

  if (wrapperName === delegateCall) return null;
  if (!sameArgs(wrapperParams, delegateArgs)) return null;

  const line = getLineNumber(text, match.index ?? 0);
  return { file: path, line, wrapperName, delegateCall };
}

function findRustPassThrough(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const fnRe =
    /(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^{]+)?\{\s*(?:return\s+)?([A-Za-z_][A-Za-z0-9_:]*)\(([^)]*)\);?\s*\}/g;

  for (const match of text.matchAll(fnRe)) {
    const wrapperName = match[1];
    const wrapperParams = parseRustParams(match[2]);
    const delegateCall = match[3];
    const delegateArgs = parseCallArgs(match[4]);

    if (wrapperName === delegateCall) continue;
    if (!sameArgs(wrapperParams, delegateArgs)) continue;

    const line = getLineNumber(text, match.index ?? 0);
    findings.push({ file: path, line, wrapperName, delegateCall });
  }

  return findings;
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
