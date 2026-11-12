import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { Schema } from "effect";

const CredentialFile = Schema.Struct({
  "openai-codex": Schema.optionalKey(
    Schema.Struct({
      type: Schema.Literal("oauth"),
      access: Schema.optionalKey(Schema.String),
      accountId: Schema.optionalKey(Schema.String),
    }),
  ),
});
const TokenClaims = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
  "https://api.openai.com/profile": Schema.optionalKey(
    Schema.Struct({ email: Schema.optionalKey(Schema.String) }),
  ),
  "https://api.openai.com/auth": Schema.optionalKey(
    Schema.Struct({
      chatgpt_account_id: Schema.optionalKey(Schema.String),
      chatgpt_plan_type: Schema.optionalKey(Schema.String),
    }),
  ),
  "https://api.openai.com/auth.chatgpt_account_id": Schema.optionalKey(Schema.String),
});

/** Non-secret profile metadata. The profile name is the stable selection key. */
export interface PiAccount {
  profile: string;
  accountId?: string;
  email?: string;
  plan?: string;
}

function claims(token: string | undefined): typeof TokenClaims.Type | undefined {
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Schema.is(TokenClaims)(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function accountMetadata(profile: string, value: typeof CredentialFile.Type): PiAccount {
  const credential = value["openai-codex"];
  const token = claims(credential?.access);
  const accountId =
    token?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
    token?.["https://api.openai.com/auth.chatgpt_account_id"] ??
    credential?.accountId;
  const email = token?.["https://api.openai.com/profile"]?.email ?? token?.email;
  const plan = token?.["https://api.openai.com/auth"]?.chatgpt_plan_type;
  return {
    profile,
    ...(accountId ? { accountId } : {}),
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
  };
}

/** List existing Pi profiles without resolving or changing the terminal's active account. */
export async function listPiAccounts(configDir: string): Promise<PiAccount[]> {
  const root = path.join(configDir, "profiles");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const profiles = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".pi-account-"))
    .map((entry) => entry.name)
    .sort();
  const accounts = await Promise.all(
    profiles.map(async (profile): Promise<PiAccount | undefined> => {
      let raw: string;
      try {
        raw = await readFile(path.join(root, profile, "auth.json"), "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid credentials for Pi profile ${profile}`);
      }
      if (!Schema.is(CredentialFile)(value))
        throw new Error(`Invalid credentials for Pi profile ${profile}`);
      return accountMetadata(profile, value);
    }),
  );
  return accounts.filter((account) => account !== undefined);
}
