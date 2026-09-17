import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { AccountProfile } from "./account-profiles.ts";
import type { CodeNavigationBackend } from "./launcher-args.ts";

const excludedToolNames = ["write", "grep", "find", "ls"];
const sharedExtensionNames = [
  "apply-patch",
  "read-tool",
  "compact-tool-output",
  "context",
  "fuzzy-at-file-autocomplete",
  "model-slots",
  "draft-stash",
  "openai-codex",
  "personal-context",
  "preview",
  "response-status",
  "waybar-agent-status",
  "shell-tool",
  "handoff-summary",
  "write-file",
  "snip",
];
const codeNavigationExtensionNames: Record<CodeNavigationBackend, string> = {
  srcwalk: "srcwalk-cli",
  tilth: "tilth-cli",
};

export function resolveExtensionNames(codeNavigation: CodeNavigationBackend): string[] {
  return [...sharedExtensionNames, codeNavigationExtensionNames[codeNavigation]];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function buildPiArgs(
  accelOs: string,
  codeNavigation: CodeNavigationBackend,
  useMcp: boolean,
): Promise<string[]> {
  const configDir = path.join(accelOs, "ai", "pi");
  const args = ["--no-extensions", "--append-system-prompt", path.join(accelOs, "ai", "SYSTEM.md")];

  for (const name of resolveExtensionNames(codeNavigation)) {
    if (name === "snip") {
      const homeDirectory = process.env["HOME"];
      if (
        homeDirectory === undefined ||
        !(await isExecutable(path.join(homeDirectory, ".local", "bin", "snip")))
      ) {
        continue;
      }
    }
    args.push("--extension", path.join(configDir, "extensions", name, "index.ts"));
  }

  if (useMcp) {
    args.push("--extension", path.join(accelOs, "node_modules", "pi-mcp-adapter"));
  }
  args.push("--exclude-tools", excludedToolNames.join(","));
  return args;
}

export function configurePiEnvironment(configDir: string, profileDirectory: string): void {
  process.env["PI_CODING_AGENT_DIR"] = profileDirectory;
  process.env["PI_CODING_AGENT_SESSION_DIR"] = path.join(configDir, "sessions");
  // Intentionally isolate Pi from the user's global Git config. In this environment,
  // `git config --global` targets the tracked agent config and must not be used.
  process.env["GIT_CONFIG_GLOBAL"] = path.join(configDir, "gitconfig");
}

export async function launchPi(
  accelOs: string,
  profile: AccountProfile,
  passthrough: readonly string[],
  codeNavigation: CodeNavigationBackend,
  useMcp: boolean,
): Promise<void> {
  const configDir = path.join(accelOs, "ai", "pi");
  process.chdir(process.env["AI_CWD"] ?? process.cwd());
  configurePiEnvironment(configDir, profile.directory);

  const args = await buildPiArgs(accelOs, codeNavigation, useMcp);
  const { main } = await import("@earendil-works/pi-coding-agent");
  await main([...args, ...passthrough]);
}
