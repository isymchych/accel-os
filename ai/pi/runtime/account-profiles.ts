import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface AccountProfile {
  name: string;
  directory: string;
  authPath: string;
}

const ACTIVE_PROFILE_FILE = "active-account.json";
const PROFILES_DIRECTORY = "profiles";
const NEW_PROFILE_NAME = ".pi-account-new";
const PROFILE_PREFIX = ".pi-account-";
const SHARED_RESOURCES = [
  "settings.json",
  "keybindings.json",
  "mcp.json",
  "models.json",
  "extensions",
  "skills",
  "prompts",
] as const;
const SHARED_RESOURCE_DIRECTORIES = new Set(["extensions", "skills", "prompts"]);

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch (error: unknown) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

function profileNameForAccountId(accountId: string): string {
  return `${PROFILE_PREFIX}${encodeURIComponent(accountId)}`;
}

function profileDirectory(configDir: string, profileName: string): string {
  return path.join(configDir, PROFILES_DIRECTORY, profileName);
}

async function ensureSharedResource(
  profileDir: string,
  configDir: string,
  resource: (typeof SHARED_RESOURCES)[number],
): Promise<void> {
  const linkPath = path.join(profileDir, resource);
  const targetPath = path.join(
    resource === "skills" || resource === "prompts" ? path.dirname(configDir) : configDir,
    resource,
  );
  const target = path.relative(profileDir, targetPath);

  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(`profile resource is not a symlink: ${linkPath}`);
    }

    const actual = await readlink(linkPath);
    if (path.resolve(profileDir, actual) !== targetPath) {
      throw new Error(`profile resource points somewhere else: ${linkPath}`);
    }
    return;
  } catch (error: unknown) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  await symlink(target, linkPath, SHARED_RESOURCE_DIRECTORIES.has(resource) ? "dir" : "file");
}

export async function ensureAccountProfile(
  configDir: string,
  profileName: string,
): Promise<AccountProfile> {
  const directory = profileDirectory(configDir, profileName);
  await mkdir(path.join(configDir, PROFILES_DIRECTORY), { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const resource of SHARED_RESOURCES) {
    await ensureSharedResource(directory, configDir, resource);
  }

  return {
    name: profileName,
    directory,
    authPath: path.join(directory, "auth.json"),
  };
}

export async function listAccountProfiles(configDir: string): Promise<AccountProfile[]> {
  const profilesDirectory = path.join(configDir, PROFILES_DIRECTORY);
  await mkdir(profilesDirectory, { recursive: true, mode: 0o700 });
  const entries = await readdir(profilesDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PROFILE_PREFIX))
    .map((entry) => entry.name)
    .sort();

  const profiles: AccountProfile[] = [];
  for (const name of names) {
    const profile = await ensureAccountProfile(configDir, name);
    if (await pathExists(profile.authPath)) {
      profiles.push(profile);
    }
  }
  return profiles;
}

export async function createNewAccountProfile(configDir: string): Promise<AccountProfile> {
  return ensureAccountProfile(configDir, NEW_PROFILE_NAME);
}

export async function findNewAccountProfile(
  configDir: string,
): Promise<AccountProfile | undefined> {
  const directory = profileDirectory(configDir, NEW_PROFILE_NAME);
  if (!(await pathExists(directory))) {
    return undefined;
  }

  return {
    name: NEW_PROFILE_NAME,
    directory,
    authPath: path.join(directory, "auth.json"),
  };
}

export async function finalizeNewAccountProfile(
  configDir: string,
  accountId: string,
): Promise<AccountProfile | undefined> {
  const pending = await findNewAccountProfile(configDir);
  if (pending === undefined || !(await pathExists(pending.authPath))) {
    return undefined;
  }

  const name = profileNameForAccountId(accountId);
  const target = profileDirectory(configDir, name);
  if (target !== pending.directory) {
    if (await pathExists(target)) {
      const profile = await ensureAccountProfile(configDir, name);
      await rename(pending.authPath, profile.authPath);
      await rm(pending.directory, { recursive: true, force: true });
      return profile;
    }
    await rename(pending.directory, target);
  }
  return ensureAccountProfile(configDir, name);
}

export async function readActiveProfileName(configDir: string): Promise<string | undefined> {
  const filePath = path.join(configDir, ACTIVE_PROFILE_FILE);
  try {
    const raw = await readFile(filePath, "utf8");
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "profile" in value &&
      typeof value.profile === "string" &&
      value.profile.startsWith(PROFILE_PREFIX)
    ) {
      return value.profile;
    }
    throw new Error(`invalid active account profile file: ${filePath}`);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function writeActiveProfileName(
  configDir: string,
  profileName: string,
): Promise<void> {
  if (!profileName.startsWith(PROFILE_PREFIX)) {
    throw new Error(`invalid account profile name: ${profileName}`);
  }
  await writeFile(
    path.join(configDir, ACTIVE_PROFILE_FILE),
    `${JSON.stringify({ profile: profileName })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}
