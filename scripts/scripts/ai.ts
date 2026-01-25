import { decodeBase64 } from "jsr:@std/encoding/base64";
import { join } from "jsr:@std/path";

// ai: thin Codex CLI wrapper for common modifiers.
// Specs:
// - `ai` launches `codex`.
// - `ai +<mcp>` enables MCP server `<mcp>` via `--config mcp_servers.<mcp>.enabled=true`.
// - `ai high` sets `model_reasoning_effort="high"`.
// - `ai medium` sets `model_reasoning_effort="medium"`.
// - `ai low` sets `model_reasoning_effort="low"`.
// - `ai account` interactively switches Codex auth.json.
// - `ai yolo` sets `--sandbox danger-full-access`.
// - Modifiers compose and parse left-to-right until `--`.
// - `ai help` prints this usage; `ai -- --help` forwards to codex.

const usage =
  `ai [high|medium|low] [yolo] [account] [+<mcp> ...] [-- <codex args...>]

Examples:
  ai
  ai account
  ai high +serena
  ai low
  ai yolo +playwright -- --help

Notes:
  - Modifiers parse until \`--\`.
  - Use \`ai -- --help\` to show Codex CLI docs.`;

type AccountInfo = {
  id: string;
  email: string;
  plan: string;
  path: string;
  isCurrent: boolean;
};

const parseAccountInfo = (
  raw: string,
  path: string,
  isCurrent: boolean,
): AccountInfo => {
  const parsed = JSON.parse(raw) as {
    tokens?: {
      account_id?: string;
      id_token?: string;
    };
  };
  const tokens = parsed.tokens ?? {};
  const payload = tokens.id_token ? parseJwtPayload(tokens.id_token) : null;
  const authClaims =
    payload && typeof payload["https://api.openai.com/auth"] === "object" &&
      payload["https://api.openai.com/auth"] !== null
      ? payload["https://api.openai.com/auth"] as Record<string, unknown>
      : null;
  const accountIdFromClaims =
    typeof authClaims?.["chatgpt_account_id"] === "string"
      ? authClaims["chatgpt_account_id"]
      : null;
  const accountId = typeof tokens.account_id === "string"
    ? tokens.account_id
    : accountIdFromClaims;
  if (!accountId) {
    throw new Error(`missing tokens.account_id in ${path}`);
  }
  const emailValue = payload?.["email"];
  const email = typeof emailValue === "string" ? emailValue : "unknown";
  const planValue = authClaims?.["chatgpt_plan_type"];
  const plan = typeof planValue === "string" ? planValue : "unknown";
  return { id: accountId, email, plan, path, isCurrent };
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
  const accelHome = Deno.env.get("ACCELERANDO_HOME");
  if (!accelHome) {
    throw new Error("ACCELERANDO_HOME is not set");
  }
  const direct = join(accelHome, "ai", "codex");
  if (await fileExists(direct)) {
    return direct;
  }
  throw new Error(`missing ai/codex under ${accelHome}`);
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
    if (selected.kind === "new") {
      console.log("No current account to rename.");
      return;
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

const configOverrides: string[] = [];
const mcps: string[] = [];
const passthrough: string[] = [];
let sandboxMode: string | null = null;
let parseModifiers = true;
let showHelp = false;
let useAccountSwitcher = false;
let hasReasoningEffort = false;

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
  if (arg === "high") {
    configOverrides.push('model_reasoning_effort="high"');
    hasReasoningEffort = true;
    continue;
  }
  if (arg === "medium") {
    configOverrides.push('model_reasoning_effort="medium"');
    hasReasoningEffort = true;
    continue;
  }
  if (arg === "low") {
    configOverrides.push('model_reasoning_effort="low"');
    hasReasoningEffort = true;
    continue;
  }
  if (arg === "account") {
    useAccountSwitcher = true;
    continue;
  }
  if (arg === "yolo") {
    sandboxMode = "danger-full-access";
    continue;
  }
  if (arg.startsWith("+") && arg.length > 1) {
    mcps.push(arg.slice(1));
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

for (const mcp of mcps) {
  configOverrides.push(`mcp_servers.${mcp}.enabled=true`);
}
if (!hasReasoningEffort) {
  configOverrides.push('model_reasoning_effort="medium"');
}

const args: string[] = [];
for (const override of configOverrides) {
  args.push("--config", override);
}
if (sandboxMode) {
  args.push("--sandbox", sandboxMode);
}
args.push(...passthrough);

const cwd = Deno.env.get("AI_CWD") ?? Deno.cwd();
const command = new Deno.Command("codex", {
  args,
  cwd,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const child = command.spawn();
const status = await child.status;
Deno.exit(status.code);
