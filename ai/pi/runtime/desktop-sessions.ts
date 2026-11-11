/**
 * Public Pi session operations for the desktop-only RPC extension. Snapshotting
 * opens a private copy because SessionManager.open can migrate and rewrite files.
 * The source is never opened by a detached manager, even for legacy histories.
 */
import { copyFile, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

interface DesktopSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name: string;
  modified: string;
}

export async function listDesktopSessions(
  sessionDir: string,
  cwd: string,
): Promise<DesktopSessionInfo[]> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  return sessions.map((session) => ({
    path: session.path,
    id: session.id,
    cwd: session.cwd,
    name: session.name ?? session.firstMessage,
    modified: session.modified.toISOString(),
  }));
}

export async function snapshotDesktopSession(
  source: string,
  entryId: string,
  sessionDir: string,
): Promise<string> {
  await mkdir(sessionDir, { recursive: true });
  const temporary = await mkdtemp(path.join(sessionDir, ".desktop-snapshot-"));
  try {
    const copy = path.join(temporary, "source.jsonl");
    await copyFile(source, copy);
    const manager = SessionManager.open(copy, temporary);
    const branch = manager.createBranchedSession(entryId);
    if (!branch) throw new Error("Pi did not create a branch");
    const header = manager.getHeader();
    if (!header) throw new Error("Pi branch has no session header");
    // Pi defers file creation for setup-only branches, but exposes their complete state.
    const contents =
      [{ ...header, parentSession: source }, ...manager.getEntries()]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n";
    // Pi creates the history; only repair lineage from the temporary copy to the source.
    const destination = path.join(sessionDir, path.basename(branch));
    const publication = path.join(temporary, "publication.jsonl");
    await writeFile(publication, contents, { flag: "wx", mode: 0o600 });
    // Same-filesystem publication is atomic and cannot overwrite another session.
    await link(publication, destination);
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
