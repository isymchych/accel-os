const SHELL_DISCOVERY_COMMAND_PATTERN =
  /(^|[;&|]\s*|\n\s*|\bxargs\s+)(rg|grep|cat|head|tail|find|fd|ls|tree)\b/gm;
const GIT_COMMAND_PATTERN =
  /(^|[;&|]\s*|\n\s*|\bxargs\s+)git\s+(?:-\S+(?:\s+\S+)?\s+)*(grep|ls-files|diff)\b/gm;

function collectShellCommands(command: string): Set<string> {
  const matches = new Set<string>();
  for (const match of command.matchAll(SHELL_DISCOVERY_COMMAND_PATTERN)) {
    const program = match[2];
    if (program !== undefined) {
      matches.add(program);
    }
  }
  for (const match of command.matchAll(GIT_COMMAND_PATTERN)) {
    const subcommand = match[2];
    if (subcommand !== undefined) {
      matches.add(`git-${subcommand}`);
    }
  }
  return matches;
}

export function createSrcwalkShellHint(
  command: string,
  activeTools: ReadonlySet<string>,
): string | undefined {
  const shellCommands = collectShellCommands(command);
  const suggestions: string[] = [];

  if (
    activeTools.has("srcwalk_discover") &&
    ["rg", "grep", "git-grep"].some((name) => shellCommands.has(name))
  ) {
    suggestions.push("use srcwalk_discover for structural or text discovery");
  }
  if (
    activeTools.has("srcwalk_read") &&
    ["cat", "head", "tail"].some((name) => shellCommands.has(name))
  ) {
    suggestions.push("use srcwalk_read for bounded source reads");
  }
  if (
    activeTools.has("srcwalk_discover") &&
    ["find", "fd", "ls", "tree", "git-ls-files"].some((name) => shellCommands.has(name))
  ) {
    suggestions.push("use srcwalk_discover with kind=file for file discovery");
  }
  if (activeTools.has("srcwalk_review") && shellCommands.has("git-diff")) {
    suggestions.push(
      "use srcwalk_review for structural change review; use git diff --patch only for exact patch text",
    );
  }

  return suggestions.length === 0
    ? undefined
    : `Hint: for code exploration, prefer srcwalk tools here: ${suggestions.join("; ")}.`;
}
