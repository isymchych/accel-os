import { decodeBase64 } from "jsr:@std/encoding/base64";
import { join } from "jsr:@std/path";

const usage =
  `ai [chat] [account] [-- <pi args...>]

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

const accelOs = Deno.env.get("ACCEL_OS");
if (!accelOs) {
  console.error("ai: ACCEL_OS is not set");
  Deno.exit(1);
}

const appendSystemPromptPath = join(accelOs, "ai", "SYSTEM.md");
const engineeringPrinciplesPath = join(
  accelOs,
  "ai",
  "docs",
  "engineering-principles.md",
);

type OAuthCredential = {
  type?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
};

type AuthFile = {
  "openai-codex"?: OAuthCredential;
};

type AccountInfo = {
  id: string;
  email: string;
  plan: string;
  path: string;
  isCurrent: boolean;
};

const decodeBase64UrlString = (input: string): string | null => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4 === 0
    ? 0
    : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padLength);
  try {
    return new TextDecoder().decode(decodeBase64(padded));
  } catch {
    return null;
  }
};

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const payload = decodeBase64UrlString(parts[1]);
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
};

const resolveAuthDir = async (): Promise<string> => {
  const direct = join(accelOs, "ai", "pi");
  if (await fileExists(direct)) {
    return direct;
  }
  throw new Error(`missing ai/pi under ${accelOs}`);
};

const parseAccountInfo = (
  raw: string,
  path: string,
  isCurrent: boolean,
): AccountInfo => {
  const parsed = JSON.parse(raw) as AuthFile;
  const credential = parsed["openai-codex"];
  if (!credential || credential.type !== "oauth") {
    throw new Error(`missing openai-codex OAuth credential in ${path}`);
  }
  const payload = credential.access ? parseJwtPayload(credential.access) : null;
  const authClaims =
    payload && typeof payload["https://api.openai.com/auth"] === "object" &&
      payload["https://api.openai.com/auth"] !== null
      ? payload["https://api.openai.com/auth"] as Record<string, unknown>
      : null;
  const profileClaims =
    payload && typeof payload["https://api.openai.com/profile"] === "object" &&
      payload["https://api.openai.com/profile"] !== null
      ? payload["https://api.openai.com/profile"] as Record<string, unknown>
      : null;
  const accountIdFromClaims =
    typeof authClaims?.["chatgpt_account_id"] === "string"
      ? authClaims["chatgpt_account_id"]
      : null;
  const accountId = typeof credential.accountId === "string"
    ? credential.accountId
    : accountIdFromClaims;
  if (!accountId) {
    throw new Error(`missing openai-codex.accountId in ${path}`);
  }
  const emailValue = profileClaims?.["email"] ?? payload?.["email"];
  const email = typeof emailValue === "string" ? emailValue : "unknown";
  const planValue = authClaims?.["chatgpt_plan_type"];
  const plan = typeof planValue === "string" ? planValue : "unknown";
  return { id: accountId, email, plan, path, isCurrent };
};

const loadAccount = async (
  path: string,
  isCurrent: boolean,
): Promise<AccountInfo> => {
  const raw = await Deno.readTextFile(path);
  return parseAccountInfo(raw, path, isCurrent);
};

const formatAccount = (account: AccountInfo, label?: string): string => {
  const tag = label ? ` ${label}` : "";
  return `${account.email} (${account.plan})${tag} ${account.id}`;
};

const promptChoice = (count: number): number => {
  const input = prompt("Choice: ");
  if (!input) {
    throw new Error("no selection provided");
  }
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > count) {
    throw new Error("invalid selection");
  }
  return parsed - 1;
};

const renameCurrent = async (
  current: AccountInfo,
  authDir: string,
): Promise<string> => {
  const targetPath = join(authDir, `${current.id}.auth.json`);
  if (await fileExists(targetPath)) {
    throw new Error(`refusing to overwrite ${targetPath}`);
  }
  await Deno.rename(current.path, targetPath);
  return targetPath;
};

const runAccountSwitcher = async (): Promise<void> => {
  if (!Deno.stdin.isTerminal()) {
    throw new Error("account switcher requires a TTY");
  }
  const authDir = await resolveAuthDir();
  const currentPath = join(authDir, "auth.json");
  const hasCurrent = await fileExists(currentPath);
  let current: AccountInfo | null = null;
  if (hasCurrent) {
    current = await loadAccount(currentPath, true);
  }

  const accounts: AccountInfo[] = [];
  const seen = new Set<string>();
  if (current) {
    accounts.push(current);
    seen.add(current.id);
  }

  for await (const entry of Deno.readDir(authDir)) {
    if (!entry.isFile) {
      continue;
    }
    if (!entry.name.endsWith(".auth.json") || entry.name === "auth.json") {
      continue;
    }
    if (entry.name.includes(".backup.")) {
      continue;
    }
    const path = join(authDir, entry.name);
    try {
      const info = await loadAccount(path, false);
      if (seen.has(info.id)) {
        console.error(`Skipping duplicate account id ${info.id} in ${path}`);
        continue;
      }
      seen.add(info.id);
      accounts.push(info);
    } catch (err) {
      console.error(`Skipping ${path}: ${(err as Error).message}`);
    }
  }

  if (accounts.length === 0) {
    throw new Error(`no auth files found in ${authDir}`);
  }

  console.log("Select account:");
  const actions: Array<
    { kind: "noop"; label: string } | { kind: "new"; label: string } | {
      kind: "switch";
      label: string;
      target: AccountInfo;
    }
  > = [];
  for (const account of accounts) {
    if (account.isCurrent) {
      actions.push({
        kind: "noop",
        label: formatAccount(account, "[current]"),
      });
    } else {
      actions.push({
        kind: "switch",
        label: formatAccount(account),
        target: account,
      });
    }
  }
  if (current) {
    actions.push({
      kind: "new",
      label: "new account (rename current auth.json)",
    });
  }

  actions.forEach((action, index) => {
    console.log(`  ${index + 1}) ${action.label}`);
  });

  const choice = promptChoice(actions.length);
  const selected = actions[choice];
  if (selected.kind === "noop") {
    console.log("Account already active.");
    return;
  }
  if (!current) {
    if (selected.kind !== "switch") {
      throw new Error("no current account to rename");
    }
    await Deno.rename(selected.target.path, currentPath);
    console.log(`Switched to ${selected.target.id}.`);
    return;
  }

  if (selected.kind === "new") {
    const renamed = await renameCurrent(current, authDir);
    console.log(`Renamed ${current.path} to ${renamed}.`);
    return;
  }

  const renamed = await renameCurrent(current, authDir);
  await Deno.rename(selected.target.path, currentPath);
  console.log(
    `Switched to ${selected.target.id}. Previous stored at ${renamed}.`,
  );
};

const passthrough: string[] = [];
let parseModifiers = true;
let showHelp = false;
let useAccountSwitcher = false;
let chatMode = false;

for (const arg of Deno.args) {
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
  console.log(usage);
  Deno.exit(0);
}

if (useAccountSwitcher) {
  try {
    await runAccountSwitcher();
    Deno.exit(0);
  } catch (err) {
    console.error(`ai account: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

const cwd = Deno.env.get("AI_CWD") ?? Deno.cwd();
const appendArgs = ["--append-system-prompt", appendSystemPromptPath];
if (!chatMode) {
  appendArgs.push("--append-system-prompt", engineeringPrinciplesPath);
}
const hasExplicitToolSelection = passthrough.some((arg) =>
  arg === "--tools" || arg.startsWith("--tools=") || arg === "--no-tools"
);
if (!hasExplicitToolSelection) {
  appendArgs.push("--tools", "read,bash,edit,write,grep,find,ls");
}
const command = new Deno.Command("pi", {
  args: [...appendArgs, ...passthrough],
  cwd,
  env: { ACCEL_OS: accelOs },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const child = command.spawn();
const status = await child.status;
Deno.exit(status.code);
