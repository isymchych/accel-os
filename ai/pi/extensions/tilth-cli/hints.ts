const SHELL_DISCOVERY_COMMAND_PATTERN =
  /(^|[;&|]\s*|\n\s*|\bxargs\s+)(rg|grep|cat|head|tail|find|fd|ls|tree)\b/gmu;
const GIT_COMMAND_PATTERN =
  /(^|[;&|]\s*|\n\s*|\bxargs\s+)git\s+(?:-\S+(?:\s+\S+)?\s+)*(grep|ls-files|diff)\b/gmu;

function collectShellDiscoveryCommands(command: string): Set<string> {
  const matches = new Set<string>();

  for (const match of command.matchAll(SHELL_DISCOVERY_COMMAND_PATTERN)) {
    const program = match[2];
    if (program !== undefined) {
      matches.add(program);
    }
  }

  for (const match of command.matchAll(GIT_COMMAND_PATTERN)) {
    const subcommand = match[2];
    if (subcommand === "grep") {
      matches.add("git-grep");
    } else if (subcommand === "ls-files") {
      matches.add("git-ls-files");
    } else if (subcommand === "diff") {
      matches.add("git-diff");
    }
  }

  return matches;
}

export function createTilthShellHint(
  command: string,
  activeTools: ReadonlySet<string>,
): string | undefined {
  const shellCommands = collectShellDiscoveryCommands(command);
  if (shellCommands.size === 0) {
    return undefined;
  }

  const suggestions: string[] = [];

  if (
    activeTools.has("tilth_search") &&
    (shellCommands.has("rg") || shellCommands.has("grep") || shellCommands.has("git-grep"))
  ) {
    suggestions.push(
      "use tilth_search instead of rg/grep/git grep for code search; for another checkout, set scope to its absolute path",
    );
  }

  if (
    activeTools.has("tilth_read") &&
    (shellCommands.has("cat") || shellCommands.has("head") || shellCommands.has("tail"))
  ) {
    suggestions.push("use tilth_read instead of cat/head/tail for file contents");
  }

  if (
    activeTools.has("tilth_list") &&
    (shellCommands.has("find") ||
      shellCommands.has("fd") ||
      shellCommands.has("ls") ||
      shellCommands.has("tree"))
  ) {
    suggestions.push("use tilth_list instead of find/fd/ls/tree for file discovery");
  }

  if (activeTools.has("tilth_list") && shellCommands.has("git-ls-files")) {
    suggestions.push(
      "use tilth_list instead of git ls-files for file discovery; for another checkout, set scope to its absolute path",
    );
  }

  if (activeTools.has("tilth_diff") && shellCommands.has("git-diff")) {
    suggestions.push(
      "use tilth_diff for structural change review; use git diff --patch only for exact patch text",
    );
  }

  if (suggestions.length === 0) {
    return undefined;
  }

  return `Hint: for code exploration, prefer Tilth tools here: ${suggestions.join("; ")}.`;
}
