export type CodeNavigationBackend = "srcwalk" | "tilth";

export interface LauncherArgs {
  codeNavigation: CodeNavigationBackend;
  passthrough: string[];
  showHelp: boolean;
  useAccountSwitcher: boolean;
  useUi: boolean;
  browser: boolean;
}

export function parseLauncherArgs(args: readonly string[]): LauncherArgs {
  let codeNavigation: CodeNavigationBackend = "srcwalk";
  let codeNavigationWasSelected = false;
  let showHelp = false;
  let useAccountSwitcher = false;
  let useUi = false;
  let browser = false;
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
    } else if (arg === "ui") {
      useUi = true;
    } else if (arg === "--browser" && useUi) {
      browser = true;
    } else {
      break;
    }
    modifierCount += 1;
  }

  if (useUi && useAccountSwitcher) {
    throw new Error("select an account with `ai account` before opening Pagoda");
  }
  if (useUi && args.length > modifierCount) {
    throw new Error("`ai ui` does not accept Pi arguments");
  }

  return {
    codeNavigation,
    passthrough: args.slice(modifierCount),
    showHelp,
    useAccountSwitcher,
    useUi,
    browser,
  };
}
