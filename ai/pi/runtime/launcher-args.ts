export type CodeNavigationBackend = "srcwalk" | "tilth";

export interface LauncherArgs {
  codeNavigation: CodeNavigationBackend;
  passthrough: string[];
  showHelp: boolean;
  useAccountSwitcher: boolean;
  useMcp: boolean;
}

export function parseLauncherArgs(args: readonly string[]): LauncherArgs {
  let codeNavigation: CodeNavigationBackend = "tilth";
  let codeNavigationWasSelected = false;
  let showHelp = false;
  let useAccountSwitcher = false;
  let useMcp = false;
  let modifierCount = 0;

  for (const arg of args) {
    if (arg === "srcwalk" || arg === "tilth") {
      if (codeNavigationWasSelected && codeNavigation !== arg) {
        throw new Error("choose only one code navigation backend: srcwalk or tilth");
      }
      codeNavigation = arg;
      codeNavigationWasSelected = true;
    } else if (arg === "help") {
      showHelp = true;
    } else if (arg === "account") {
      useAccountSwitcher = true;
    } else if (arg === "mcp") {
      useMcp = true;
    } else {
      break;
    }
    modifierCount += 1;
  }

  return {
    codeNavigation,
    passthrough: args.slice(modifierCount),
    showHelp,
    useAccountSwitcher,
    useMcp,
  };
}
