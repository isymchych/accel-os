import process from "node:process";
import { createInterface } from "node:readline/promises";

import { renderUsageSummary } from "../extensions/openai-codex/status.ts";
import {
  type OpenAICodexUsageCredential,
  fetchUsageSnapshotForCredential,
} from "../extensions/openai-codex/usage.ts";
import {
  type AccountProfile,
  createNewAccountProfile,
  writeActiveProfileName,
} from "./account-profiles.ts";
import { type AccountInfo, loadAccount, reconcileAccountProfiles } from "./accounts.ts";

const accountUsageTimeoutMs = 20_000;

type AccountAction =
  | { kind: "noop"; labelLines: string[]; account: AccountInfo }
  | { kind: "new"; labelLines: string[] }
  | { kind: "switch"; labelLines: string[]; account: AccountInfo };

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function fetchAccountUsageSummary(account: AccountInfo): Promise<string> {
  if (account.accessToken === undefined) {
    return "usage unavailable";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, accountUsageTimeoutMs);

  try {
    const credential: OpenAICodexUsageCredential = {
      accessToken: account.accessToken,
      accountId: account.id,
    };
    if (account.email !== undefined) {
      credential.email = account.email;
    }
    if (account.plan !== undefined) {
      credential.plan = account.plan;
    }

    const snapshot = await fetchUsageSnapshotForCredential(credential, {
      signal: controller.signal,
    });
    return renderUsageSummary(snapshot);
  } catch {
    return "usage unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAccountUsageSummaries(
  accounts: readonly AccountInfo[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    accounts.map(async (account): Promise<readonly [string, string]> => [
      account.id,
      await fetchAccountUsageSummary(account),
    ]),
  );
  return new Map(entries);
}

function formatAccountActionLines(account: AccountInfo, usageSummary: string): string[] {
  const currentMarker = account.isCurrent ? "*" : " ";
  return [
    `${currentMarker} ${account.email ?? "unknown"} (${account.plan ?? "unknown"})`,
    `  id: ${account.id}`,
    `  ${usageSummary}`,
  ];
}

function renderAction(action: AccountAction, index: number): void {
  const prefix = `  ${index + 1}) `;
  const continuationPrefix = " ".repeat(prefix.length);
  const firstLine = action.labelLines[0];
  if (firstLine === undefined) {
    return;
  }
  writeStdout(`${prefix}${firstLine}`);
  for (const line of action.labelLines.slice(1)) {
    writeStdout(`${continuationPrefix}${line}`);
  }
}

async function promptChoice(count: number, defaultIndex?: number): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const prompt = defaultIndex === undefined ? "Choice: " : `Choice [${defaultIndex + 1}]: `;
    const input = await rl.question(prompt);
    if (input.length === 0) {
      if (defaultIndex !== undefined) {
        return defaultIndex;
      }
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
}

export async function selectAccountProfile(configDir: string): Promise<AccountProfile> {
  if (!process.stdin.isTTY) {
    throw new Error("account switcher requires a TTY");
  }

  const { profiles, activeProfileName } = await reconcileAccountProfiles(configDir);
  const accounts = await Promise.all(
    profiles.map(async (profile) => loadAccount(profile, profile.name === activeProfileName)),
  );

  writeStdout("Loading usage...");
  const usageByAccountId = await fetchAccountUsageSummaries(accounts);

  writeStdout("Select account:");
  writeStdout("");
  const actions: AccountAction[] = accounts.map((account) => {
    const usageSummary = usageByAccountId.get(account.id) ?? "usage unavailable";
    const labelLines = formatAccountActionLines(account, usageSummary);
    return account.isCurrent
      ? { kind: "noop", labelLines, account }
      : { kind: "switch", labelLines, account };
  });
  actions.push({ kind: "new", labelLines: ["+ new account"] });

  actions.forEach((action, index) => {
    renderAction(action, index);
    if (index < actions.length - 1) {
      writeStdout("");
    }
  });

  const defaultIndex = actions.findIndex((action) => action.kind === "noop");
  const selected =
    actions[await promptChoice(actions.length, defaultIndex === -1 ? undefined : defaultIndex)];
  if (selected === undefined) {
    throw new Error("invalid selection");
  }
  if (selected.kind === "new") {
    const profile = await createNewAccountProfile(configDir);
    await writeActiveProfileName(configDir, profile.name);
    writeStdout("New account profile selected. Run /login and choose OpenAI Codex.");
    return profile;
  }

  await writeActiveProfileName(configDir, selected.account.profile.name);
  if (selected.kind === "noop") {
    writeStdout("Account already active.");
  } else {
    writeStdout(`Selected ${selected.account.id}.`);
  }
  return selected.account.profile;
}
