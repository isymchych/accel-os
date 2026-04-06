#!/usr/bin/env -S deno run --quiet --allow-run=git

import { runGit } from "../../lib/git_command.ts";

type Mode =
  | { kind: "workspace" }
  | { kind: "staged" }
  | { kind: "base"; baseRef: string };

type BoundaryFinding = {
  file: string;
  change: "added" | "removed";
  kind: "export" | "entrypoint";
  line: string;
};

const mode = parseMode(Deno.args);
const diffArgs = getDiffArgs(mode);
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

if (result.stdout === "") {
  console.log("No diff.");
  Deno.exit(0);
}

const findings = collectBoundaryFindings(result.stdout);
if (findings.length === 0) {
  console.log("No boundary-level interface changes detected.");
  Deno.exit(0);
}

const grouped = new Map<string, BoundaryFinding[]>();
for (const finding of findings) {
  const entries = grouped.get(finding.file) ?? [];
  entries.push(finding);
  grouped.set(finding.file, entries);
}

console.log("Boundary changes:");
for (const [file, entries] of grouped.entries()) {
  console.log(`\n${file}`);
  for (const entry of entries) {
    const marker = entry.change === "added" ? "+" : "-";
    console.log(`  ${marker} [${entry.kind}] ${entry.line}`);
  }
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

function getDiffArgs(mode: Mode): string[] {
  const shared = ["diff", "--no-color", "--no-ext-diff", "--unified=0"];
  if (mode.kind === "workspace") return [...shared, "HEAD"];
  if (mode.kind === "staged") return [...shared, "--staged"];
  return [...shared, `${mode.baseRef}...HEAD`];
}

function collectBoundaryFindings(diffText: string): BoundaryFinding[] {
  const lines = diffText.split("\n");
  const findings: BoundaryFinding[] = [];
  let currentFile = "";

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length).trim();
      continue;
    }
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (currentFile === "" || currentFile === "/dev/null") continue;

    const change: "added" | "removed" = line.startsWith("+") ? "added" : "removed";
    const content = line.slice(1).trim();
    if (content === "") continue;

    if (isBoundaryExport(content)) {
      findings.push({ file: currentFile, change, kind: "export", line: content });
      continue;
    }

    if (isEntrypointChange(currentFile, content)) {
      findings.push({ file: currentFile, change, kind: "entrypoint", line: content });
    }
  }

  return findings;
}

function isBoundaryExport(content: string): boolean {
  if (/^export\s+/.test(content)) return true;
  if (/^export\s*\{/.test(content)) return true;
  if (/^module\.exports\s*=/.test(content)) return true;
  if (/^exports\.[A-Za-z0-9_$]+\s*=/.test(content)) return true;
  if (/^pub(\([^)]*\))?\s+/.test(content)) return true;
  return false;
}

function isEntrypointChange(file: string, content: string): boolean {
  if (file.endsWith("package.json")) {
    return /"(exports|main|module|types)"\s*:/.test(content);
  }

  const entrypointSuffixes = [
    "index.ts",
    "index.tsx",
    "index.js",
    "index.jsx",
    "mod.rs",
    "lib.rs",
    "main.rs",
  ];
  return entrypointSuffixes.some((suffix) => file.endsWith(suffix));
}
