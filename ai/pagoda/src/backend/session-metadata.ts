import { readFileSync, writeFileSync } from "node:fs";

import { Value } from "typebox/value";

import { MetadataSchema, type SessionId, type SessionMetadata } from "../desktop-api.ts";

/** Pagoda presentation metadata, independent of Pi's native session files. */
export class SessionMetadataStore {
  private memory: SessionMetadata[] = [];
  private readonly file: string | undefined;

  public constructor(file?: string) {
    this.file = file;
  }

  public list(): SessionMetadata[] {
    if (!this.file) return structuredClone(this.memory);
    let contents: string;
    try {
      contents = readFileSync(this.file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const value: unknown = JSON.parse(contents);
    if (!Value.Check(MetadataSchema, value)) throw new Error("Invalid Pagoda session metadata");
    return value.map(({ id, pinned, favourite }) => ({ id, pinned, favourite }));
  }

  private update(id: SessionId, change: (entry: SessionMetadata) => SessionMetadata): void {
    const entries = this.list();
    const index = entries.findIndex((entry) => entry.id === id);
    const previous = index < 0 ? { id, pinned: false, favourite: false } : entries[index];
    if (!previous) throw new Error("Invalid session metadata");
    const next = change(previous);
    if (index < 0) entries.push(next);
    else entries[index] = next;
    if (!this.file) {
      this.memory = entries;
      return;
    }
    writeFileSync(this.file, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  }

  public setFlag(id: SessionId, flag: "pinned" | "favourite", value: boolean): void {
    this.update(id, (entry) => ({ ...entry, [flag]: value }));
  }
}
