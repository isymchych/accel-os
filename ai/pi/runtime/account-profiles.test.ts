import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createNewAccountProfile,
  ensureAccountProfile,
  finalizeNewAccountProfile,
  readActiveProfileName,
  writeActiveProfileName,
} from "./account-profiles.ts";

async function createConfigDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-account-profiles-"));
  const configDir = path.join(root, "ai", "pi");
  await mkdir(path.join(configDir, "extensions"), { recursive: true });
  await mkdir(path.join(root, "ai", "skills", "example"), { recursive: true });
  await mkdir(path.join(root, "ai", "prompts"), { recursive: true });
  await writeFile(path.join(root, "ai", "skills", "example", "SKILL.md"), "skill\n");
  await writeFile(path.join(root, "ai", "prompts", "example.md"), "prompt\n");
  for (const fileName of [
    "settings.json",
    "keybindings.json",
    "mcp.json",
    "models.json",
  ] as const) {
    await writeFile(path.join(configDir, fileName), "{}\n");
  }
  return configDir;
}

test("account profiles link shared Pi configuration and isolate auth", async () => {
  const configDir = await createConfigDir();
  const profile = await ensureAccountProfile(configDir, ".pi-account-account-1");

  await writeFile(profile.authPath, "credential-1\n", { mode: 0o600 });

  assert.equal(profile.directory, path.join(configDir, "profiles", ".pi-account-account-1"));
  assert.equal(
    await readFile(path.join(profile.directory, "skills", "example", "SKILL.md"), "utf8"),
    "skill\n",
  );
  assert.equal(
    await readFile(path.join(profile.directory, "prompts", "example.md"), "utf8"),
    "prompt\n",
  );
  assert.equal(await readFile(profile.authPath, "utf8"), "credential-1\n");
  assert.equal(await readFile(path.join(profile.directory, "settings.json"), "utf8"), "{}\n");
});

test("repairs missing profile symlinks before startup", async () => {
  const configDir = await createConfigDir();
  const profile = await ensureAccountProfile(configDir, ".pi-account-account-1");

  await rm(path.join(profile.directory, "skills"));
  await rm(path.join(profile.directory, "extensions"));

  await ensureAccountProfile(configDir, profile.name);

  assert.equal(
    await readFile(path.join(profile.directory, "skills", "example", "SKILL.md"), "utf8"),
    "skill\n",
  );
  assert.equal(await readlink(path.join(profile.directory, "extensions")), "../../extensions");
  assert.equal(await readlink(path.join(profile.directory, "skills")), "../../../skills");
});

test("a completed new-account login is promoted to its account profile", async () => {
  const configDir = await createConfigDir();
  const pending = await createNewAccountProfile(configDir);
  await writeFile(pending.authPath, "credential");

  await writeActiveProfileName(configDir, pending.name);
  const finalized = await finalizeNewAccountProfile(configDir, "account-1");

  assert.ok(finalized);
  assert.equal(finalized.name, ".pi-account-account-1");
  assert.equal(await readFile(finalized.authPath, "utf8"), "credential");
  assert.equal(await readActiveProfileName(configDir), ".pi-account-new");
});

test("a repeated login refreshes the existing account profile", async () => {
  const configDir = await createConfigDir();
  const existing = await ensureAccountProfile(configDir, ".pi-account-account-1");
  await writeFile(existing.authPath, "old credential");
  const pending = await createNewAccountProfile(configDir);
  await writeFile(pending.authPath, "refreshed credential");

  const finalized = await finalizeNewAccountProfile(configDir, "account-1");

  assert.equal(finalized?.name, existing.name);
  assert.equal(await readFile(existing.authPath, "utf8"), "refreshed credential");
  await assert.rejects(readFile(pending.authPath, "utf8"), { code: "ENOENT" });
});

test("rejects a profile resource that is not the expected symlink", async () => {
  const configDir = await createConfigDir();
  const profileDir = path.join(configDir, "profiles", ".pi-account-account-1");
  await mkdir(profileDir, { recursive: true });
  await symlink("../../settings.json", path.join(profileDir, "settings.json"));
  await writeFile(path.join(profileDir, "mcp.json"), "{}\n");

  await assert.rejects(
    ensureAccountProfile(configDir, ".pi-account-account-1"),
    /profile resource is not a symlink/u,
  );
});
