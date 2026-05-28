const SHELL_DISCOVERY_COMMAND_PATTERN = /(^|[;&|]\s*|\n\s*|\bxargs\s+)(rg|grep|cat|find|fd)\b/gm;

function collectShellDiscoveryCommands(command: string): Set<string> {
  const matches = new Set<string>();

  for (const match of command.matchAll(SHELL_DISCOVERY_COMMAND_PATTERN)) {
    const program = match[2];
    if (program !== undefined) {
      matches.add(program);
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

  if (activeTools.has("tilth_search") && (shellCommands.has("rg") || shellCommands.has("grep"))) {
    suggestions.push("use tilth_search instead of rg/grep for code search");
  }

  if (activeTools.has("tilth_read") && shellCommands.has("cat")) {
    suggestions.push("use tilth_read instead of cat for file contents");
  }

  if (activeTools.has("tilth_files") && (shellCommands.has("find") || shellCommands.has("fd"))) {
    suggestions.push("use tilth_files instead of find/fd for file discovery");
  }

  if (suggestions.length === 0) {
    return undefined;
  }

  return `Hint: for code exploration, prefer Tilth tools here: ${suggestions.join("; ")}.`;
}
