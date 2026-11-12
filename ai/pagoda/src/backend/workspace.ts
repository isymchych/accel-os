import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { Deferred, Effect, Exit, Fiber, Scope, Semaphore } from "effect";

import type {
  Account,
  HistoryEntryId,
  Prompt,
  SessionId,
  SessionKey,
  SessionSnapshot,
  StoredSession,
  WorkspaceState,
} from "../contracts/index.ts";
import { SessionCatalog } from "./catalog.ts";
import { operationError, OperationRejected, type OperationError } from "./errors.ts";
import { WorkspaceObservations } from "./observation.ts";
import { listPiAccounts } from "./pi/accounts.ts";
import type { PiSessionOptions, PiSessionFactory } from "./pi/session.ts";
import type { SessionMetadataStore } from "./session-metadata.ts";
import { DesktopSession } from "./session.ts";
import { DEFAULT_INACTIVITY_HOURS } from "./settings.ts";

/** Owns session scopes and backend commands; clients own only their reads and observations. */
export class DesktopWorkspace {
  private readonly sessions = new Map<SessionKey, DesktopSession>();
  private readonly opening = new Map<string, Deferred.Deferred<SessionSnapshot, OperationError>>();
  private readonly metadataLock = Semaphore.makeUnsafe(1);
  public readonly observations = new WorkspaceObservations(() => this.observedSnapshot());
  private closing = false;
  private selectedAccount: string | undefined;
  private initial!: DesktopSession;
  private closeEffect!: Effect.Effect<void>;
  private readonly catalog: SessionCatalog;
  private readonly scope: Scope.Closeable;
  private readonly launch: PiSessionOptions;
  private readonly metadataStore: SessionMetadataStore | undefined;
  private readonly inactivityHours: number;
  private readonly accountConfigDir: string | undefined;
  private readonly sessionFactory: PiSessionFactory | undefined;

  private constructor(
    scope: Scope.Closeable,
    launch: PiSessionOptions,
    metadataStore: SessionMetadataStore | undefined,
    inactivityHours: number,
    accountConfigDir: string | undefined,
    sessionFactory: PiSessionFactory | undefined,
  ) {
    this.scope = scope;
    this.launch = launch;
    this.metadataStore = metadataStore;
    this.inactivityHours = inactivityHours;
    this.accountConfigDir = accountConfigDir;
    this.sessionFactory = sessionFactory;
    this.catalog = new SessionCatalog(launch.sessionDir);
  }

  public static make(
    launch: PiSessionOptions,
    metadataStore?: SessionMetadataStore,
    inactivityHours = DEFAULT_INACTIVITY_HOURS,
    accountConfigDir?: string,
    sessionFactory?: PiSessionFactory,
  ): Effect.Effect<DesktopWorkspace, OperationError, Scope.Scope> {
    return Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope, "parallel");
      const workspace = new DesktopWorkspace(
        scope,
        launch,
        metadataStore,
        inactivityHours,
        accountConfigDir,
        sessionFactory,
      );
      workspace.closeEffect = yield* Effect.cached(
        Effect.sync(() => {
          workspace.closing = true;
        }).pipe(Effect.andThen(Scope.close(scope, Exit.void))),
      );
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          workspace.closing = true;
          workspace.observations.close();
        }),
      );
      yield* Effect.gen(function* () {
        if (accountConfigDir) {
          const accounts = yield* workspace.accounts();
          workspace.selectedAccount = accounts[0]?.profile;
          if (!workspace.selectedAccount)
            return yield* Effect.fail(
              new OperationRejected({ error: "No Pi accounts are available" }),
            );
        }
        workspace.initial = workspace.attach(
          yield* DesktopSession.make(
            workspace.sessionOptions(launch.cwd, launch.sessionFile),
            sessionFactory,
          ).pipe(Scope.provide(scope)),
        );
        return undefined;
      }).pipe(Effect.onError(() => workspace.close()));
      return workspace;
    });
  }

  public get initialKey(): SessionKey {
    return this.initial.summary().key;
  }

  /** Start commands in the backend scope; losing their HTTP response does not cancel them. */
  public command<A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E | OperationRejected> {
    return Effect.gen({ self: this }, function* () {
      if (this.closing)
        return yield* Effect.fail(new OperationRejected({ error: "The backend is shutting down" }));
      const fiber = yield* operation.pipe(Effect.forkIn(this.scope));
      return yield* Fiber.join(fiber);
    });
  }

  public snapshot(): Effect.Effect<WorkspaceState, OperationError> {
    return this.observedSnapshot().pipe(Effect.map(({ state }) => state));
  }

  private observedSnapshot(): Effect.Effect<
    { state: WorkspaceState; revision: number },
    OperationError
  > {
    // The outer lock coordinates persisted metadata reads with observation publication.
    return this.metadataLock.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const metadata = this.metadataStore ? yield* this.metadataStore.list() : [];
        return {
          state: {
            initialKey: this.initialKey,
            sessions: [...this.sessions.values()].map((session) => session.snapshot()),
            metadata,
            selectedAccount: this.selectedAccount ?? null,
            inactivityHours: this.inactivityHours,
          },
          revision: this.observations.currentRevision(),
        };
      }),
    );
  }

  public session(key: SessionKey): Effect.Effect<DesktopSession, OperationRejected> {
    return Effect.suspend(() => {
      const session = this.sessions.get(key);
      return session && !this.closing
        ? Effect.succeed(session)
        : Effect.fail(new OperationRejected({ error: "This session is unavailable" }));
    });
  }

  public prompt(request: Prompt): Effect.Effect<string, OperationError> {
    return this.session(request.key).pipe(
      Effect.flatMap((session) => session.prompt(request.message, request.mode)),
    );
  }

  public accounts(): Effect.Effect<readonly Account[], OperationError> {
    return Effect.suspend(() => {
      const configDir = this.accountConfigDir;
      if (!configDir)
        return Effect.fail(
          new OperationRejected({ error: "Account configuration is unavailable" }),
        );
      return Effect.tryPromise({
        try: () => listPiAccounts(configDir),
        catch: operationError,
      });
    });
  }

  public selectAccount(profile: string): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      if (!(yield* this.accounts()).some((account) => account.profile === profile))
        return yield* Effect.fail(
          new OperationRejected({ error: "Choose an available Pi account" }),
        );
      this.selectedAccount = profile;
      this.observations.publish({ type: "account", value: profile });
      return undefined;
    });
  }

  public directory(cwd: string): Effect.Effect<string, OperationError> {
    return Effect.tryPromise({
      try: async () => {
        const directory = await realpath(cwd);
        if (!(await stat(directory)).isDirectory())
          throw new OperationRejected({ error: "Choose a directory" });
        return directory;
      },
      catch: pathError,
    });
  }

  public setMetadataFlag(
    id: SessionId,
    flag: "pinned" | "favourite",
    value: boolean,
  ): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      if (!this.metadataStore)
        return yield* Effect.fail(
          new OperationRejected({ error: "Session metadata is unavailable" }),
        );
      if (!(yield* this.listAll()).some((session) => session.id === id))
        return yield* Effect.fail(
          new OperationRejected({ error: "Session is not in the catalog" }),
        );
      const store = this.metadataStore;
      yield* this.metadataLock.withPermits(1)(
        Effect.gen({ self: this }, function* () {
          const metadata = yield* store.setFlag(id, flag, value);
          this.observations.publish({ type: "metadata", value: metadata });
        }),
      );
      return undefined;
    });
  }

  private attach(session: DesktopSession): DesktopSession {
    this.sessions.set(session.summary().key, session);
    session.subscribe((snapshot) => {
      this.observations.publish({ type: "snapshot", value: snapshot });
    });
    return session;
  }

  public list(cwd: string): Effect.Effect<readonly StoredSession[], OperationError> {
    return Effect.gen({ self: this }, function* () {
      const directory = yield* Effect.tryPromise({ try: () => realpath(cwd), catch: pathError });
      if (this.closing)
        return yield* Effect.fail(new OperationRejected({ error: "The backend is shutting down" }));
      return yield* Effect.tryPromise({
        try: () => this.catalog.list(directory),
        catch: operationError,
      });
    });
  }

  public listAll(): Effect.Effect<readonly StoredSession[], OperationError> {
    return Effect.suspend(() => {
      if (this.closing)
        return Effect.fail(new OperationRejected({ error: "The backend is shutting down" }));
      return Effect.tryPromise({ try: () => this.catalog.list(), catch: operationError });
    });
  }

  public create(cwd: string): Effect.Effect<SessionSnapshot, OperationError> {
    return Effect.flatMap(
      Effect.tryPromise({ try: () => realpath(cwd), catch: pathError }),
      (directory) => this.launchSession(directory),
    );
  }

  public open(cwd: string, sessionPath: string): Effect.Effect<SessionSnapshot, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const directory = yield* Effect.tryPromise({
        try: () => realpath(cwd),
        catch: pathError,
      });
      const canonical = yield* Effect.tryPromise({
        try: () => realpath(sessionPath),
        catch: pathError,
      });
      return yield* Effect.suspend(() => {
        const pending = this.opening.get(canonical);
        if (pending) return Deferred.await(pending);
        // Reserve synchronously before catalog discovery or SDK acquisition can yield.
        const result = Deferred.makeUnsafe<SessionSnapshot, OperationError>();
        this.opening.set(canonical, result);
        return this.openStored(directory, canonical).pipe(
          Effect.onExit((exit) =>
            Effect.gen({ self: this }, function* () {
              this.opening.delete(canonical);
              yield* Deferred.done(result, exit);
            }),
          ),
        );
      });
    });
  }

  private openStored(
    cwd: string,
    sessionPath: string,
  ): Effect.Effect<SessionSnapshot, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const stored = (yield* this.list(cwd)).find((entry) => entry.path === sessionPath);
      if (!stored)
        return yield* Effect.fail(
          new OperationRejected({ error: "Choose a native session from this directory's catalog" }),
        );
      const matching = [...this.sessions.values()].filter((session) => {
        const summary = session.summary();
        return summary.sessionId === stored.id || summary.sessionFile === sessionPath;
      });
      const existing = matching.find((session) => session.summary().connection === "connected");
      if (existing) return existing.snapshot();
      // Dispose every prior writer before acquiring a replacement.
      yield* Effect.all(
        matching.map((session) => session.close()),
        { concurrency: "unbounded" },
      );
      return yield* this.launchSession(cwd, sessionPath);
    });
  }

  private sessionOptions(cwd: string, sessionFile?: string): PiSessionOptions {
    return {
      ...this.launch,
      cwd,
      ...(sessionFile ? { sessionFile } : {}),
      ...(this.accountConfigDir && this.selectedAccount
        ? { profileDir: path.join(this.accountConfigDir, "profiles", this.selectedAccount) }
        : {}),
    };
  }

  private launchSession(
    cwd: string,
    sessionPath?: string,
  ): Effect.Effect<SessionSnapshot, OperationError> {
    return Effect.gen({ self: this }, function* () {
      if (this.closing)
        return yield* Effect.fail(new OperationRejected({ error: "The backend is shutting down" }));
      const session = yield* DesktopSession.make(
        this.sessionOptions(cwd, sessionPath),
        this.sessionFactory,
      ).pipe(Scope.provide(this.scope));
      // Shutdown can begin while the SDK is being acquired.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (this.closing)
        return yield* Effect.fail(new OperationRejected({ error: "The backend is shutting down" }));
      this.attach(session);
      const snapshot = session.snapshot();
      this.observations.publish({ type: "snapshot", value: snapshot });
      return snapshot;
    });
  }

  public fork(
    key: SessionKey,
    entryId: HistoryEntryId,
  ): Effect.Effect<SessionSnapshot, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const source = yield* this.session(key);
      const sessionPath = yield* source.fork(entryId);
      return yield* this.open(source.summary().cwd, sessionPath);
    });
  }

  public close(): Effect.Effect<void> {
    return this.closeEffect;
  }
}

/** Missing user-selected paths are rejections; other filesystem failures are operational. */
function pathError(cause: unknown): OperationError {
  if (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  ) {
    return Object.assign(new OperationRejected({ error: cause.message }), { cause });
  }
  return operationError(cause);
}
