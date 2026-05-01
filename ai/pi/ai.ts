#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { isRecord } from "./lib/guards.ts";
import {
  parseOpenAICodexCredential,
  readOpenAICodexAccountProfile,
} from "./lib/openai-codex-auth.ts";

const usage = `ai [chat] [account] [-- <pi args...>]

Examples:
  ai
  ai chat
  ai account
  ai -- --help

Notes:
  - By default, ai appends both ai/SYSTEM.md and ai/docs/engineering-principles.md.
  - \`chat\` skips appending ai/docs/engineering-principles.md.
  - \`account\` swaps ai/pi/auth.json between saved OpenAI Codex logins.
  - Saved accounts are stored as <accountId>.auth.json next to auth.json.
  - Use \`ai -- --help\` to show Pi CLI docs.`;

const accelOs = process.env["ACCEL_OS"];
if (accelOs === undefined || accelOs.length === 0) {
  process.stderr.write("ai: ACCEL_OS is not set\n");
  process.exit(1);
}

const appendSystemPromptPath = path.join(accelOs, "ai", "SYSTEM.md");
const engineeringPrinciplesPath = path.join(accelOs, "ai", "docs", "engineering-principles.md");

type AccountInfo = {
  id: string;
  email: string;
  plan: string;
  path: string;
  isCurrent: boolean;
};

type AccountAction =
  | { kind: "noop"; label: string }
  | { kind: "new"; label: string }
  | { kind: "switch"; label: string; target: AccountInfo };

type LoadedAccount =
  | { kind: "ok"; filePath: string; info: AccountInfo }
  | { kind: "error"; filePath: string; message: string };

const writeStdout = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const writeStderr = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const isErrnoException = (value: unknown): value is NodeJS.ErrnoException => {
  return value instanceof Error && "code" in value;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
};

const resolveAuthDir = async (): Promise<string> => {
  const direct = path.join(accelOs, "ai", "pi");
  if (await fileExists(direct)) {
    return direct;
  }
  throw new Error(`missing ai/pi under ${accelOs}`);
};

const parseAccountInfo = (raw: string, filePath: string, isCurrent: boolean): AccountInfo => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`invalid auth file structure in ${filePath}`);
  }

  const credential = parseOpenAICodexCredential(parsed["openai-codex"]);
  if (credential === null) {
    throw new Error(`missing openai-codex OAuth credential in ${filePath}`);
  }

  const profile =
    credential.access === undefined ? {} : readOpenAICodexAccountProfile(credential.access);
  const accountId = credential.accountId ?? profile.accountId;
  if (accountId === undefined || accountId.length === 0) {
    throw new Error(`missing openai-codex.accountId in ${filePath}`);
  }

  const email = profile.email ?? "unknown";
  const plan = profile.plan ?? "unknown";

  return { id: accountId, email, plan, path: filePath, isCurrent };
};

const loadAccount = async (filePath: string, isCurrent: boolean): Promise<AccountInfo> => {
  const raw = await readFile(filePath, "utf8");
  return parseAccountInfo(raw, filePath, isCurrent);
};

const formatAccount = (account: AccountInfo, label?: string): string => {
  const tag = label !== undefined ? ` ${label}` : "";
  return `${account.email} (${account.plan})${tag} ${account.id}`;
};

const promptChoice = async (count: number): Promise<number> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const input = await rl.question("Choice: ");
    if (input.length === 0) {
      throw new Error("no selection provided");
    }
    const parsed = Number.parseInt(input, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > count) {
      throw new Error("invalid selection");
    }
    return parsed - 1;
  } finally {
    rl.close();
  }
};

const renameCurrent = async (current: AccountInfo, authDir: string): Promise<string> => {
  const targetPath = path.join(authDir, `${current.id}.auth.json`);
  if (await fileExists(targetPath)) {
    throw new Error(`refusing to overwrite ${targetPath}`);
  }
  await rename(current.path, targetPath);
  return targetPath;
};

const runAccountSwitcher = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    throw new Error("account switcher requires a TTY");
  }

  const authDir = await resolveAuthDir();
  const currentPath = path.join(authDir, "auth.json");
  const hasCurrent = await fileExists(currentPath);
  let current: AccountInfo | null = null;
  if (hasCurrent) {
    current = await loadAccount(currentPath, true);
  }

  const accounts: AccountInfo[] = [];
  const seen = new Set<string>();
  if (current !== null) {
    accounts.push(current);
    seen.add(current.id);
  }

  const entries = await readdir(authDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith(".auth.json") && entry.name !== "auth.json")
    .filter((entry) => !entry.name.includes(".backup."))
    .map((entry) => ({ filePath: path.join(authDir, entry.name) }));

  const loadedAccounts: LoadedAccount[] = await Promise.all(
    candidates.map(async ({ filePath }) => {
      try {
        return { kind: "ok", filePath, info: await loadAccount(filePath, false) };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "error", filePath, message };
      }
    }),
  );

  for (const loaded of loadedAccounts) {
    if (loaded.kind === "error") {
      writeStderr(`Skipping ${loaded.filePath}: ${loaded.message}`);
      continue;
    }
    if (seen.has(loaded.info.id)) {
      writeStderr(`Skipping duplicate account id ${loaded.info.id} in ${loaded.filePath}`);
      continue;
    }
    seen.add(loaded.info.id);
    accounts.push(loaded.info);
  }

  if (accounts.length === 0) {
    throw new Error(`no auth files found in ${authDir}`);
  }

  writeStdout("Select account:");
  const actions: AccountAction[] = [];
  for (const account of accounts) {
    if (account.isCurrent) {
      actions.push({ kind: "noop", label: formatAccount(account, "[current]") });
    } else {
      actions.push({ kind: "switch", label: formatAccount(account), target: account });
    }
  }
  if (current !== null) {
    actions.push({ kind: "new", label: "new account (rename current auth.json)" });
  }

  actions.forEach((action, index) => {
    writeStdout(`  ${index + 1}) ${action.label}`);
  });

  const choice = await promptChoice(actions.length);
  const selected = actions[choice];
  if (selected === undefined) {
    throw new Error("invalid selection");
  }
  if (selected.kind === "noop") {
    writeStdout("Account already active.");
    return;
  }
  if (current === null) {
    if (selected.kind !== "switch") {
      throw new Error("no current account to rename");
    }
    await rename(selected.target.path, currentPath);
    writeStdout(`Switched to ${selected.target.id}.`);
    return;
  }

  if (selected.kind === "new") {
    const renamed = await renameCurrent(current, authDir);
    writeStdout(`Renamed ${current.path} to ${renamed}.`);
    return;
  }

  const renamed = await renameCurrent(current, authDir);
  await rename(selected.target.path, currentPath);
  writeStdout(`Switched to ${selected.target.id}. Previous stored at ${renamed}.`);
};

const passthrough: string[] = [];
let parseModifiers = true;
let showHelp = false;
let useAccountSwitcher = false;
let chatMode = false;

for (const arg of process.argv.slice(2)) {
  if (!parseModifiers) {
    passthrough.push(arg);
    continue;
  }
  if (arg === "--") {
    parseModifiers = false;
    passthrough.push(arg);
    continue;
  }
  if (arg === "help") {
    showHelp = true;
    continue;
  }
  if (arg === "account") {
    useAccountSwitcher = true;
    continue;
  }
  if (arg === "chat") {
    chatMode = true;
    continue;
  }
  passthrough.push(arg);
}

if (showHelp) {
  writeStdout(usage);
  process.exit(0);
}

if (useAccountSwitcher) {
  try {
    await runAccountSwitcher();
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    writeStderr(`ai account: ${message}`);
    process.exit(1);
  }
}

const cwd = process.env["AI_CWD"] ?? process.cwd();
process.chdir(cwd);

const appendArgs = ["--append-system-prompt", appendSystemPromptPath];
if (!chatMode) {
  appendArgs.push("--append-system-prompt", engineeringPrinciplesPath);
}
const hasExplicitToolSelection = passthrough.some(
  (arg) => arg === "--tools" || arg.startsWith("--tools=") || arg === "--no-tools",
);
if (!hasExplicitToolSelection) {
  appendArgs.push("--tools", "read,bash,edit,write,grep,find,ls,codex_web_search");
}
const { main } = await import("@mariozechner/pi-coding-agent");
await main([...appendArgs, ...passthrough]);
