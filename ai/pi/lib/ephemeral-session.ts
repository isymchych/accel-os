import { randomUUID } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  CURRENT_SESSION_VERSION,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";

const EPHEMERAL_DIR_PREFIX = "pi-ephemeral-";
const EPHEMERAL_SESSION_FILE_NAME = "session.jsonl";

export interface SessionBranchSource {
  getBranch(fromId?: string): SessionEntry[];
  getCwd(): string;
  getSessionFile(): string | undefined;
}

export interface CreateEphemeralSessionFileOptions {
  sessionManager: SessionBranchSource;
  targetLeafId: string | null;
  baseDir?: string;
}

export interface EphemeralSessionFile {
  sessionDir: string;
  sessionFile: string;
}

function resolveEphemeralBaseDir(baseDir?: string): string {
  return baseDir ?? process.env["XDG_RUNTIME_DIR"] ?? tmpdir();
}

function buildSessionHeader(sessionManager: SessionBranchSource): SessionHeader {
  const headerBase: SessionHeader = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: sessionManager.getCwd(),
  };

  const parentSession = sessionManager.getSessionFile();
  if (parentSession === undefined) {
    return headerBase;
  }

  return {
    ...headerBase,
    parentSession,
  };
}

function serializeJsonl(
  entries: readonly SessionHeader[] | readonly (SessionHeader | SessionEntry)[],
): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function isManagedEphemeralSessionPath(sessionFile: string): boolean {
  const resolvedSessionFile = resolve(sessionFile);
  const sessionDirName = basename(dirname(resolvedSessionFile));
  return (
    basename(resolvedSessionFile) === EPHEMERAL_SESSION_FILE_NAME &&
    sessionDirName.startsWith(EPHEMERAL_DIR_PREFIX)
  );
}

export async function createEphemeralSessionFile(
  options: CreateEphemeralSessionFileOptions,
): Promise<EphemeralSessionFile> {
  const sessionDir = await mkdtemp(
    join(resolveEphemeralBaseDir(options.baseDir), EPHEMERAL_DIR_PREFIX),
  );
  const sessionFile = join(sessionDir, EPHEMERAL_SESSION_FILE_NAME);
  const branchEntries =
    options.targetLeafId === null ? [] : options.sessionManager.getBranch(options.targetLeafId);

  if (options.targetLeafId !== null && branchEntries.length === 0) {
    throw new Error(`No branch found for entry ${options.targetLeafId}.`);
  }

  const header = buildSessionHeader(options.sessionManager);
  await writeFile(sessionFile, serializeJsonl([header, ...branchEntries]), "utf8");

  return { sessionDir, sessionFile };
}

export async function removeEphemeralSessionArtifacts(sessionFile: string): Promise<void> {
  if (!isManagedEphemeralSessionPath(sessionFile)) {
    return;
  }

  const resolvedSessionFile = resolve(sessionFile);
  await rm(resolvedSessionFile, { force: true });

  const sessionDir = dirname(resolvedSessionFile);
  try {
    const remaining = await readdir(sessionDir);
    if (remaining.length === 0) {
      await rm(sessionDir, { force: true, recursive: true });
    }
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

export function removeEphemeralSessionArtifactsSync(sessionFile: string): void {
  if (!isManagedEphemeralSessionPath(sessionFile)) {
    return;
  }

  const resolvedSessionFile = resolve(sessionFile);
  try {
    rmSync(resolvedSessionFile, { force: true });
  } catch {
    // Ignore best-effort cleanup failures.
  }

  const sessionDir = dirname(resolvedSessionFile);
  try {
    if (readdirSync(sessionDir).length === 0) {
      rmSync(sessionDir, { force: true, recursive: true });
    }
  } catch {
    // Ignore best-effort cleanup failures.
  }
}
