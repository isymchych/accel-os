import { randomUUID } from "node:crypto";
import path from "node:path";

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Deferred, Effect, Exit, Fiber, FiberSet, Schema, Scope } from "effect";

import {
  HistorySchema,
  SummarySchema,
  type ContentBlock,
  type HistoryEntryId,
  type SessionControls,
  type SessionHistory,
  type SessionSnapshot,
  type SessionSummary,
} from "../contracts/index.ts";
import { SessionCatalog } from "./catalog.ts";
import { operationError, OperationRejected, type OperationError } from "./errors.ts";
import { transcriptMessage } from "./pi/presentation.ts";
import {
  createPiSession,
  disposePiSession,
  type PiSessionOptions,
  type PiSessionFactory,
} from "./pi/session.ts";
import { piUi } from "./pi/ui.ts";
import { projectSessionEvent } from "./session-projection.ts";

type PromptDisposition = "started" | "queued" | "handled";

/** One scoped SDK execution owner with independent command and presentation lifetimes. */
export class DesktopSession {
  private sdk: AgentSession | undefined;
  private closeEffect!: Effect.Effect<void>;
  private operations!: FiberSet.FiberSet;
  private unsubscribe = (): void => {};
  private closed = false;
  private busy = false;
  private stopping = false;
  private accepting: Deferred.Deferred<PromptDisposition, OperationError> | undefined;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private notification: ReturnType<typeof setTimeout> | undefined;
  private streamingBlocks: ReadonlyMap<number, ContentBlock> = new Map();
  private state: SessionSnapshot;
  private readonly catalog: SessionCatalog;

  private constructor(options: PiSessionOptions) {
    this.catalog = new SessionCatalog(options.sessionDir);
    this.state = {
      key: Schema.decodeUnknownSync(SummarySchema.fields.key)(randomUUID()),
      revision: 0,
      controlsRevision: 0,
      historyRevision: 0,
      connection: "starting",
      execution: "unknown",
      cwd: options.cwd,
      sessionId: null,
      sessionFile: null,
      name: path.basename(options.cwd),
      messages: [],
      streaming: [],
      tools: [],
      activity: null,
      error: null,
      notice: null,
    };
  }

  public static make(
    options: PiSessionOptions,
    factory?: PiSessionFactory,
  ): Effect.Effect<DesktopSession, OperationError, Scope.Scope> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const parent = yield* Effect.scope;
        const scope = yield* Scope.make();
        const operationsScope = yield* Scope.make();
        const owner = new DesktopSession(options);
        owner.operations = yield* FiberSet.make().pipe(Scope.provide(operationsScope));
        owner.closeEffect = yield* Effect.cached(
          Effect.sync(() => {
            owner.closed = true;
          }).pipe(Effect.andThen(Scope.close(scope, Exit.void))),
        );
        yield* Scope.addFinalizer(scope, owner.shutdown(operationsScope));
        yield* Scope.addFinalizer(parent, owner.close());
        // Join startup before shutdown: acquisition and binding cannot be cancelled.
        const startup = yield* owner
          .initialize(options, factory)
          .pipe(Effect.uninterruptible, Effect.forkIn(scope));
        yield* restore(Fiber.join(startup)).pipe(Effect.onError(() => owner.close()));
        return owner;
      }),
    );
  }

  private initialize(
    options: PiSessionOptions,
    factory?: PiSessionFactory,
  ): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const sdk = yield* Effect.tryPromise({
        try: () => (factory ?? createPiSession)(options),
        catch: operationError,
      });
      this.sdk = sdk;
      this.unsubscribe = sdk.subscribe((event) => {
        this.receive(event);
      });
      yield* Effect.tryPromise({
        try: () =>
          sdk.bindExtensions({
            mode: "print",
            uiContext: piUi(sdk.extensionRunner.getUIContext(), (notice) => {
              this.update({ notice });
            }),
            onError: (error) => {
              this.update({ error: `Extension error: ${error.error}` });
            },
          }),
        catch: operationError,
      });
      this.refresh();
    });
  }

  private get owner(): AgentSession {
    if (this.closed || !this.sdk)
      throw new OperationRejected({ error: "Pi session is unavailable" });
    return this.sdk;
  }

  private shutdown(operationsScope: Scope.Closeable): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const sdk = this.sdk;
      // Pi cannot abort input/auth preflight before a run exists. Wait for that
      // boundary, then abort before draining fibers waiting for execution to end.
      yield* Effect.gen({ self: this }, function* () {
        if (this.accepting) yield* Deferred.await(this.accepting).pipe(Effect.exit);
        if (sdk) yield* Effect.promise(() => sdk.abort());
      }).pipe(
        Effect.ensuring(Scope.close(operationsScope, Exit.void)),
        Effect.ensuring(
          Effect.sync(() => {
            this.unsubscribe();
          }),
        ),
        Effect.ensuring(sdk ? disposePiSession(sdk) : Effect.void),
        Effect.ensuring(
          Effect.sync(() => {
            clearTimeout(this.notification);
            this.update({ connection: "disconnected", execution: "unknown" });
            this.listeners.clear();
          }),
        ),
      );
    });
  }

  private forkOperation<A>(
    operation: Effect.Effect<A, OperationError>,
  ): Effect.Effect<Fiber.Fiber<A, OperationError>, OperationRejected> {
    return Effect.suspend(() => {
      if (this.closed)
        return Effect.fail(new OperationRejected({ error: "Pi session is unavailable" }));
      // SDK Promises cannot be interrupted. Their fibers live until settlement,
      // even when a request or workspace command stops waiting.
      return FiberSet.run(this.operations, operation.pipe(Effect.uninterruptible));
    });
  }

  private run<A>(operation: Effect.Effect<A, OperationError>): Effect.Effect<A, OperationError> {
    return this.forkOperation(operation).pipe(Effect.flatMap(Fiber.join));
  }

  public snapshot(): SessionSnapshot {
    return structuredClone(this.state);
  }

  public summary(): SessionSummary {
    const { key, revision, connection, execution, cwd, sessionId, sessionFile, name } = this.state;
    return { key, revision, connection, execution, cwd, sessionId, sessionFile, name };
  }

  public subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private refresh(): void {
    const session = this.owner;
    this.streamingBlocks = new Map();
    this.update({
      connection: "connected",
      sessionId: Schema.decodeUnknownSync(SummarySchema.fields.sessionId)(session.sessionId),
      sessionFile: session.sessionFile ?? null,
      name: session.sessionManager.getSessionName() ?? this.state.name,
      execution: session.isStreaming || session.isCompacting ? "running" : "idle",
      messages: session.messages
        .filter((message) => message.role !== "custom" || message.display)
        .map(transcriptMessage),
      streaming: [],
      tools: [],
      controlsRevision: this.state.controlsRevision + 1,
      historyRevision: this.state.historyRevision + 1,
    });
  }

  public prompt(
    message: string,
    mode: "prompt" | "steer" | "follow_up" = "prompt",
  ): Effect.Effect<PromptDisposition, OperationError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (message.trim().length === 0)
          return yield* Effect.fail(new OperationRejected({ error: "Enter a message." }));
        if (
          this.closed ||
          this.state.connection !== "connected" ||
          this.busy ||
          this.state.execution === "unknown" ||
          this.state.execution === "stopping" ||
          (mode === "prompt" && this.state.execution !== "idle")
        ) {
          return yield* Effect.fail(
            new OperationRejected({
              error: "Wait until Pi is connected and ready before sending.",
            }),
          );
        }
        const accepted = yield* Deferred.make<PromptDisposition, OperationError>();
        this.busy = true;
        this.update({ error: null, notice: null });
        yield* this.forkOperation(
          Effect.tryPromise({
            try: () => {
              const sdk = this.owner;
              this.accepting = accepted;
              return sdk.prompt(message, {
                ...(mode === "prompt"
                  ? {}
                  : { streamingBehavior: mode === "follow_up" ? "followUp" : "steer" }),
                // Pi declares this hook internal; its use for authoritative acceptance
                // is an approved integration exception, separate from completion.
                preflightResult: (disposition) => {
                  this.accepting = undefined;
                  this.busy = false;
                  if (!this.closed) {
                    this.update({
                      notice: this.state.notice ?? `Input: ${disposition}.`,
                      controlsRevision: this.state.controlsRevision + 1,
                    });
                  }
                  Deferred.doneUnsafe(accepted, Effect.succeed(disposition));
                },
              });
            },
            catch: operationError,
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                // A rejected SDK preflight is a command rejection, not an execution failure.
                const rejection = Object.assign(new OperationRejected({ error: error.message }), {
                  cause: error,
                });
                const rejected = Deferred.doneUnsafe(accepted, Effect.fail(rejection));
                if (rejected) {
                  this.accepting = undefined;
                  this.busy = false;
                }
                if (!this.closed) {
                  this.update({
                    error:
                      error instanceof Error
                        ? error.message
                        : rejected
                          ? "Pi did not accept the input."
                          : "Pi execution failed.",
                    controlsRevision: this.state.controlsRevision + (rejected ? 1 : 0),
                  });
                }
              }),
            ),
          ),
        );
        return yield* restore(Deferred.await(accepted));
      }),
    );
  }

  public stop(): Effect.Effect<void, OperationError> {
    return this.run(
      Effect.gen({ self: this }, function* () {
        if (this.stopping || this.state.connection !== "connected") return;
        this.stopping = true;
        this.update({ execution: "stopping" });
        yield* Effect.tryPromise({
          try: () => this.owner.abort(),
          catch: operationError,
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.update({ execution: "idle", activity: null, notice: "Stopped." });
            }),
          ),
          Effect.tapError(() =>
            Effect.sync(() => {
              this.update({ execution: "unknown", error: "Pi has not confirmed cancellation." });
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              this.stopping = false;
              this.update({ controlsRevision: this.state.controlsRevision + 1 });
            }),
          ),
        );
      }),
    );
  }

  public history(): Effect.Effect<SessionHistory, OperationError> {
    return Effect.try({
      try: () => {
        const manager = this.owner.sessionManager;
        return Schema.decodeUnknownSync(HistorySchema)({
          leafId: manager.getLeafId(),
          entries: manager.getEntries().map((entry) => ({
            id: entry.id,
            parentId: entry.parentId,
            label:
              entry.type === "message"
                ? `${entry.message.role}: ${transcriptMessage(entry.message)
                    .content.flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join("\n")
                    .slice(0, 140)}`
                : `${entry.type}: ${"summary" in entry ? entry.summary.slice(0, 100) : entry.id}`,
          })),
        });
      },
      catch: operationError,
    });
  }

  public navigate(entryId: HistoryEntryId): Effect.Effect<string | undefined, OperationError> {
    return this.mutate(
      Effect.tryPromise({
        try: async () => {
          const result = await this.owner.navigateTree(entryId, { summarize: false });
          if (result.cancelled)
            throw new OperationRejected({ error: "Pi cancelled history navigation." });
          this.refresh();
          return result.editorText;
        },
        catch: operationError,
      }),
    );
  }

  public fork(entryId: HistoryEntryId): Effect.Effect<string, OperationError> {
    return Effect.tryPromise({
      try: () => {
        if (!this.state.sessionFile)
          throw new OperationRejected({ error: "This session has no persisted history yet" });
        return this.catalog.snapshot(this.state.sessionFile, entryId);
      },
      catch: operationError,
    });
  }

  public controls(): Effect.Effect<SessionControls, OperationError> {
    return this.run(
      Effect.tryPromise({
        try: async () => {
          const session = this.owner;
          const models = await session.modelRuntime.getAvailable();
          return {
            models: models.map(({ provider, id, name }) => ({ provider, id, name })),
            model: session.model
              ? { provider: session.model.provider, id: session.model.id }
              : null,
            thinkingLevel: session.thinkingLevel,
            levels: session.getAvailableThinkingLevels(),
            pendingMessageCount: session.pendingMessageCount,
          };
        },
        catch: operationError,
      }),
    );
  }

  public model(provider: string, modelId: string): Effect.Effect<void, OperationError> {
    return this.mutate(
      Effect.tryPromise({
        try: async () => {
          const model = this.owner.modelRuntime.getModel(provider, modelId);
          if (!model) throw new OperationRejected({ error: "Unknown Pi model" });
          await this.owner.setModel(model);
        },
        catch: operationError,
      }),
    );
  }

  public thinking(level: string): Effect.Effect<void, OperationError> {
    return this.mutate(
      Effect.try({
        try: () => {
          const value = this.owner.getAvailableThinkingLevels().find((item) => item === level);
          if (!value) throw new OperationRejected({ error: "Unsupported thinking level" });
          this.owner.setThinkingLevel(value);
        },
        catch: operationError,
      }),
    );
  }

  private mutate<A>(operation: Effect.Effect<A, OperationError>): Effect.Effect<A, OperationError> {
    return this.run(
      Effect.gen({ self: this }, function* () {
        if (this.closed || this.state.execution !== "idle" || this.busy)
          return yield* Effect.fail(
            new OperationRejected({ error: "Wait until Pi is connected and idle." }),
          );
        this.busy = true;
        return yield* operation.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.busy = false;
              this.update({
                controlsRevision: this.state.controlsRevision + 1,
                historyRevision: this.state.historyRevision + 1,
              });
            }),
          ),
        );
      }),
    );
  }

  public close(): Effect.Effect<void> {
    return this.closeEffect;
  }

  private receive(event: AgentSessionEvent): void {
    if (this.closed) return;
    const sdk = this.owner;
    const projection = projectSessionEvent(this.state, this.streamingBlocks, event, {
      sessionId: sdk.sessionId,
      sessionFile: sdk.sessionFile,
      stopping: this.stopping,
    });
    if (!projection) return;
    if (projection.refresh) {
      try {
        this.refresh();
      } catch (error) {
        this.update({
          error: error instanceof Error ? error.message : "Could not refresh compacted history",
        });
      }
      return;
    }
    if (projection.streamingBlocks) this.streamingBlocks = projection.streamingBlocks;
    this.update(projection.change, projection.coalesce);
  }

  private update(change: Partial<SessionSnapshot>, coalesce = false): void {
    this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
    if (coalesce)
      this.notification ??= setTimeout(() => {
        this.notify();
      }, 40);
    else this.notify();
  }

  private notify(): void {
    clearTimeout(this.notification);
    this.notification = undefined;
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
