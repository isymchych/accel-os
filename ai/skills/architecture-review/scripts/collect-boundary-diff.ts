import { runGit } from "../../lib/git_command.ts";

type Mode = { kind: "workspace" } | { kind: "staged" } | { kind: "base"; baseRef: string };

type BoundaryFinding = {
  file: string;
  change: "added" | "removed";
  kind: "export" | "entrypoint";
  line: string;
};

const selectedMode = parseMode(process.argv.slice(2));
const diffArgs = getDiffArgs(selectedMode);
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

if (result.stdout === "") {
  console.log("No diff.");
  process.exit(0);
}

const boundaryFindings = collectBoundaryFindings(result.stdout);
if (boundaryFindings.length === 0) {
  console.log("No boundary-level interface changes detected.");
  process.exit(0);
}

const grouped = new Map<string, BoundaryFinding[]>();
for (const finding of boundaryFindings) {
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

function getDiffArgs(requestedMode: Mode): string[] {
  const shared = ["diff", "--no-color", "--no-ext-diff", "--unified=0"];
  if (requestedMode.kind === "workspace") return [...shared, "HEAD"];
  if (requestedMode.kind === "staged") return [...shared, "--staged"];
  return [...shared, `${requestedMode.baseRef}...HEAD`];
}

function collectBoundaryFindings(diffText: string): BoundaryFinding[] {
  const lines = diffText.split("\n");
  const collectedFindings: BoundaryFinding[] = [];
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
      collectedFindings.push({ file: currentFile, change, kind: "export", line: content });
      continue;
    }

    if (isEntrypointChange(currentFile, content)) {
      collectedFindings.push({ file: currentFile, change, kind: "entrypoint", line: content });
    }
  }

  return collectedFindings;
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
