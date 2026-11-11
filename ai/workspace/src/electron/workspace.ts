import { realpath } from "node:fs/promises";

import type { SessionSnapshot, SessionSummary, StoredSession } from "../desktop-api.ts";
import type { PiLaunch } from "./rpc.ts";
import { DesktopSession } from "./session.ts";

/** One main-owned child per open conversation; view selection is never execution state. */
export class DesktopWorkspace {
  private readonly sessions = new Map<string, DesktopSession>();
  private readonly opening = new Map<string, Promise<SessionSnapshot>>();
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private closing = false;
  public readonly initialKey: string;
  private readonly initial: DesktopSession;

  public constructor(privateLaunch: PiLaunch) {
    this.launch = privateLaunch;
    this.initial = this.attach(new DesktopSession(privateLaunch));
    this.initialKey = this.initial.summary().key;
  }
  private readonly launch: PiLaunch;

  public async start(): Promise<void> {
    await this.initial.start();
  }
  public snapshot(): { initialKey: string; sessions: SessionSummary[] } {
    return {
      initialKey: this.initialKey,
      sessions: [...this.sessions.values()].map((session) => session.summary()),
    };
  }
  public session(key: string): DesktopSession {
    const session = this.sessions.get(key);
    if (!session || this.closing) throw new Error("This desktop session is unavailable");
    return session;
  }
  public subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private attach(session: DesktopSession): DesktopSession {
    this.sessions.set(session.summary().key, session);
    session.subscribe((snapshot) => {
      for (const listener of this.listeners) listener(snapshot);
    });
    return session;
  }
  public async list(cwd: string): Promise<StoredSession[]> {
    const directory = await realpath(cwd);
    const owner = [...this.sessions.values()].find(
      (session) => session.summary().connection === "connected",
    );
    if (!owner || this.closing) throw new Error("No connected Pi session is available");
    return owner.list(directory);
  }
  public async create(cwd: string): Promise<SessionSnapshot> {
    return this.launchSession(await realpath(cwd));
  }
  public async open(cwd: string, sessionPath: string): Promise<SessionSnapshot> {
    const directory = await realpath(cwd);
    const canonical = await realpath(sessionPath);
    // Reserve before discovery or process startup: concurrent reopen requests share the owner.
    const pending = this.opening.get(canonical);
    if (pending) return pending;
    const operation = this.openStored(directory, canonical);
    this.opening.set(canonical, operation);
    try {
      return await operation;
    } finally {
      this.opening.delete(canonical);
    }
  }
  private async openStored(cwd: string, sessionPath: string): Promise<SessionSnapshot> {
    // Discovery itself uses a live Pi child. If all owners exited, start a
    // fresh untitled owner rather than requiring an application restart.
    if (
      ![...this.sessions.values()].some((session) => session.summary().connection === "connected")
    ) {
      await this.launchSession(cwd);
    }
    const catalog = await this.list(cwd);
    const stored = catalog.find((entry) => entry.path === sessionPath);
    if (!stored) throw new Error("Choose a native session from this directory's catalog");
    const matching = [...this.sessions.values()].filter((session) => {
      const summary = session.summary();
      return summary.sessionId === stored.id || summary.sessionFile === sessionPath;
    });
    const existing = matching.find((session) => session.summary().connection === "connected");
    if (existing) return existing.snapshot();
    // A broken transport can precede process exit; wait for disposal before
    // opening another writer for the same native session.
    await Promise.all(matching.map(async (session) => session.close()));
    return this.launchSession(cwd, sessionPath);
  }
  private async launchSession(cwd: string, sessionPath?: string): Promise<SessionSnapshot> {
    if (this.closing) throw new Error("The desktop is shutting down");
    const session = this.attach(
      new DesktopSession({
        ...this.launch,
        cwd,
        env: { ...this.launch.env, AI_CWD: cwd },
        args: [...this.launch.args, ...(sessionPath ? ["--session", sessionPath] : [])],
      }),
    );
    await session.start();
    return session.snapshot();
  }
  public async fork(key: string, entryId: string): Promise<SessionSnapshot> {
    const source = this.session(key);
    const cwd = source.summary().cwd;
    const sessionPath = await source.fork(entryId);
    return this.open(cwd, sessionPath);
  }
  public async close(): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled(
      [...this.sessions.values()].map(async (session) => session.close()),
    );
    this.listeners.clear();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) throw new Error("Could not close every Pi session");
  }
}
