import { copyFile, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";

import { StoredSessionsSchema, type StoredSession } from "../contracts/index.ts";

/** Discover and snapshot native sessions without opening a writer on their source files. */
export class SessionCatalog {
  private readonly sessionDir: string;

  public constructor(sessionDir: string) {
    this.sessionDir = sessionDir;
  }

  public async list(cwd?: string): Promise<readonly StoredSession[]> {
    const sessions = cwd
      ? await SessionManager.list(cwd, this.sessionDir)
      : await SessionManager.listAll(this.sessionDir);
    return Schema.decodeUnknownSync(StoredSessionsSchema)(
      sessions.map((session) => ({
        path: session.path,
        id: session.id,
        cwd: session.cwd,
        name: session.name ?? session.firstMessage,
        modified: session.modified.toISOString(),
      })),
    );
  }

  public async snapshot(source: string, entryId: string): Promise<string> {
    await mkdir(this.sessionDir, { recursive: true });
    const temporary = await mkdtemp(path.join(this.sessionDir, ".pagoda-snapshot-"));
    try {
      // Opening a legacy session may migrate it. Only open a private copy.
      const copy = path.join(temporary, "source.jsonl");
      await copyFile(source, copy);
      const manager = SessionManager.open(copy, temporary);
      const branch = manager.createBranchedSession(entryId);
      if (!branch) throw new Error("Pi did not create a branch");
      const header = manager.getHeader();
      if (!header) throw new Error("Pi branch has no session header");
      // Setup-only branches are not necessarily persisted by Pi.
      const contents =
        [{ ...header, parentSession: source }, ...manager.getEntries()]
          .map((entry) => JSON.stringify(entry))
          .join("\n") + "\n";
      const destination = path.join(this.sessionDir, path.basename(branch));
      const publication = path.join(temporary, "publication.jsonl");
      await writeFile(publication, contents, { flag: "wx", mode: 0o600 });
      await link(publication, destination);
      return destination;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
