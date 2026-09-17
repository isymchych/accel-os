#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { selectAccountProfile } from "./runtime/account-switcher.ts";
import { resolveAccountProfile } from "./runtime/accounts.ts";
import { parseLauncherArgs } from "./runtime/launcher-args.ts";
import { launchPi } from "./runtime/pi-launcher.ts";

const usage = `ai [account] [mcp] [tilth|srcwalk] [-- <pi args...>]

Examples:
  ai
  ai srcwalk
  ai account
  ai mcp
  ai -- --help

Notes:
  - By default, ai appends ai/SYSTEM.md.
  - ai loads its extensions explicitly; Pi extension auto-discovery is disabled.
  - ai loads Pi-native, one-shot Tilth CLI tools by default; \`srcwalk\` selects srcwalk instead.
  - \`mcp\` enables the MCP proxy tool for this run.
  - ai excludes built-in tools superseded by this configuration: write, grep, find, and ls.
  - \`account\` selects an isolated OpenAI Codex credential profile and then opens Pi.
  - Each profile has its own auth.json, so changing accounts does not affect existing chats.
  - Use \`ai -- --help\` to show Pi CLI docs.`;

function requireAccelOs(): string {
  const accelOs = process.env["ACCEL_OS"];
  if (accelOs === undefined || accelOs.length === 0) {
    throw new Error("ACCEL_OS is not set");
  }
  return accelOs;
}

async function main(): Promise<void> {
  const { codeNavigation, passthrough, showHelp, useAccountSwitcher, useMcp } = parseLauncherArgs(
    process.argv.slice(2),
  );
  if (showHelp) {
    process.stdout.write(`${usage}\n`);
    return;
  }

  const accelOs = requireAccelOs();
  const configDir = path.join(accelOs, "ai", "pi");
  const profile = useAccountSwitcher
    ? await selectAccountProfile(configDir)
    : await resolveAccountProfile(configDir);
  await launchPi(accelOs, profile, passthrough, codeNavigation, useMcp);
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ai: ${message}\n`);
  process.exitCode = 1;
}
