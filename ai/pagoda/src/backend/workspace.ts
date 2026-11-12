import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type {
  HistoryEntryId,
  Prompt,
  SessionId,
  SessionKey,
  SessionMetadata,
  SessionSnapshot,
  StoredSession,
  WorkspaceState,
} from "../contracts/index.ts";
import { SessionCatalog } from "./catalog.ts";
import { listPiAccounts } from "./pi/accounts.ts";
import type { PiSessionOptions, PiSessionFactory } from "./pi/session.ts";
import type { SessionMetadataStore } from "./session-metadata.ts";
import { DesktopSession } from "./session.ts";

/** One backend-owned SDK owner per open session; view selection is never execution state. */
export class DesktopWorkspace {
  private readonly sessions = new Map<SessionKey, DesktopSession>();
  private readonly opening = new Map<string, Promise<SessionSnapshot>>();
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private readonly metadataListeners = new Set<(metadata: SessionMetadata[]) => void>();
  private readonly accountListeners = new Set<(profile: string) => void>();
  private closing = false;
  private selectedAccount: string | undefined;
  public readonly initialKey: SessionKey;
  private readonly initial: DesktopSession;
  private readonly catalog: SessionCatalog;
  private readonly sessionFactory: PiSessionFactory | undefined;

  public constructor(
    privateLaunch: PiSessionOptions,
    privateMetadata?: SessionMetadataStore,
    inactivityHours = 48,
    accountConfigDir?: string,
    sessionFactory?: PiSessionFactory,
  ) {
    this.sessionFactory = sessionFactory;
    this.launch = privateLaunch;
    this.catalog = new SessionCatalog(privateLaunch.sessionDir);
    this.metadataStore = privateMetadata;
    this.inactivityHours = inactivityHours;
    this.accountConfigDir = accountConfigDir;
    this.initial = this.attach(new DesktopSession(privateLaunch, sessionFactory));
    this.initialKey = this.initial.summary().key;
  }
  private readonly launch: PiSessionOptions;
  private readonly metadataStore: SessionMetadataStore | undefined;
  private readonly inactivityHours: number;
  private readonly accountConfigDir: string | undefined;

  public async start(): Promise<void> {
    if (this.accountConfigDir) {
      const accounts = await this.accounts();
      this.selectedAccount = accounts[0]?.profile;
      if (!this.selectedAccount) throw new Error("No Pi accounts are available");
    }
    await this.initial.start(this.selectedProfileDir());
  }
  public snapshot(): WorkspaceState {
    return {
      initialKey: this.initialKey,
      sessions: [...this.sessions.values()].map((session) => session.snapshot()),
      metadata: this.metadataStore?.list() ?? [],
      selectedAccount: this.selectedAccount ?? null,
      inactivityHours: this.inactivityHours,
    };
  }
  public session(key: SessionKey): DesktopSession {
    const session = this.sessions.get(key);
    if (!session || this.closing) throw new Error("This session is unavailable");
    return session;
  }
  public async prompt(request: Prompt): Promise<string> {
    return this.session(request.key).prompt(request.message, request.mode);
  }
  public async accounts(): ReturnType<typeof listPiAccounts> {
    if (!this.accountConfigDir) throw new Error("Account configuration is unavailable");
    return listPiAccounts(this.accountConfigDir);
  }
  public account(): string | undefined {
    return this.selectedAccount;
  }
  public async selectAccount(profile: string): Promise<void> {
    if (!(await this.accounts()).some((account) => account.profile === profile))
      throw new Error("Choose an available Pi account");
    this.selectedAccount = profile;
    for (const listener of this.accountListeners) listener(profile);
  }
  public subscribeAccount(listener: (profile: string) => void): () => void {
    this.accountListeners.add(listener);
    return () => {
      this.accountListeners.delete(listener);
    };
  }
  private selectedProfileDir(): string | undefined {
    if (!this.accountConfigDir || !this.selectedAccount) return undefined;
    return path.join(this.accountConfigDir, "profiles", this.selectedAccount);
  }
  public async directory(cwd: string): Promise<string> {
    const directory = await realpath(cwd);
    if (!(await stat(directory)).isDirectory()) throw new Error("Choose a directory");
    return directory;
  }
  public subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  public subscribeMetadata(listener: (metadata: SessionMetadata[]) => void): () => void {
    this.metadataListeners.add(listener);
    return () => {
      this.metadataListeners.delete(listener);
    };
  }
  public async setMetadataFlag(
    id: SessionId,
    flag: "pinned" | "favourite",
    value: boolean,
  ): Promise<void> {
    if (!this.metadataStore) throw new Error("Session metadata is unavailable");
    if (!(await this.listAll()).some((session) => session.id === id)) {
      throw new Error("Session is not in the catalog");
    }
    this.metadataStore.setFlag(id, flag, value);
    this.publishMetadata();
  }
  private publishMetadata(): void {
    const metadata = this.metadataStore?.list() ?? [];
    for (const listener of this.metadataListeners) listener(metadata);
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
    if (this.closing) throw new Error("The backend is shutting down");
    return this.catalog.list(directory);
  }
  public async listAll(): Promise<StoredSession[]> {
    if (this.closing) throw new Error("The backend is shutting down");
    return this.catalog.list();
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
    const catalog = await this.list(cwd);
    const stored = catalog.find((entry) => entry.path === sessionPath);
    if (!stored) throw new Error("Choose a native session from this directory's catalog");
    const matching = [...this.sessions.values()].filter((session) => {
      const summary = session.summary();
      return summary.sessionId === stored.id || summary.sessionFile === sessionPath;
    });
    const existing = matching.find((session) => session.summary().connection === "connected");
    if (existing) return existing.snapshot();
    // Release the previous owner before opening another writer for this native session.
    await Promise.all(matching.map(async (session) => session.close()));
    return this.launchSession(cwd, sessionPath);
  }
  private async launchSession(cwd: string, sessionPath?: string): Promise<SessionSnapshot> {
    if (this.closing) throw new Error("The backend is shutting down");
    const session = this.attach(
      new DesktopSession(
        {
          ...this.launch,
          cwd,
          ...(sessionPath ? { sessionFile: sessionPath } : {}),
        },
        this.sessionFactory,
      ),
    );
    await session.start(this.selectedProfileDir());
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Shutdown can begin during SDK acquisition.
    if (this.closing) throw new Error("The backend is shutting down");
    return session.snapshot();
  }
  public async fork(key: SessionKey, entryId: HistoryEntryId): Promise<SessionSnapshot> {
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
    this.metadataListeners.clear();
    this.accountListeners.clear();
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) throw new Error("Could not close every Pi session");
  }
}
