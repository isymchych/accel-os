import path from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { Effect, Exit, Scope } from "effect";

export interface PiSessionOptions {
  cwd: string;
  agentDir: string;
  profileDir: string;
  sessionDir: string;
  sharedDir: string;
  sessionFile?: string;
}
export type PiSessionFactory = (options: PiSessionOptions) => Promise<AgentSession>;

/** Confirm prompt acceptance without waiting for its independently owned execution to finish. */
export function submitPiPrompt(
  session: AgentSession,
  text: string,
  mode: "prompt" | "steer" | "follow_up",
  onExecutionError: (error: unknown) => void,
): Promise<"started" | "queued" | "handled"> {
  return new Promise((resolve, reject) => {
    let accepted = false;
    void session
      .prompt(text, {
        ...(mode === "prompt"
          ? {}
          : { streamingBehavior: mode === "follow_up" ? "followUp" : "steer" }),
        // The SDK labels this hook internal; its RPC mode uses it for the same
        // acceptance contract. Its use here is an explicitly accepted exception.
        preflightResult: (disposition) => {
          accepted = true;
          resolve(disposition);
        },
      })
      .catch((error: unknown) => {
        if (accepted) onExecutionError(error);
        else reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

/** Acquire a cwd-bound SDK session whose work and credential writes end with its scope. */
export function scopedPiSession(
  options: PiSessionOptions,
  factory: PiSessionFactory = createPiSession,
): Effect.Effect<AgentSession, unknown, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({ try: () => factory(options), catch: (error) => error }),
    (session) =>
      Effect.promise(async () => {
        try {
          await session.abort();
        } finally {
          try {
            session.dispose();
          } finally {
            await session.modelRuntime.settleCredentialWrites();
          }
        }
      }),
  );
}

/** Pagoda's explicit SDK configuration, independent of the terminal launcher. */
export const createPiSession: PiSessionFactory = async (options) => {
  const settings = SettingsManager.inMemory();
  const resources = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: settings,
    noExtensions: true,
    additionalSkillPaths: [path.join(options.sharedDir, "skills")],
    additionalPromptTemplatePaths: [path.join(options.sharedDir, "prompts")],
    appendSystemPrompt: [path.join(options.sharedDir, "SYSTEM.md")],
  });
  await resources.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(options.profileDir, "auth.json"),
    modelsPath: path.join(options.agentDir, "models.json"),
    allowModelNetwork: false,
  });
  const sessionManager = options.sessionFile
    ? SessionManager.open(options.sessionFile, options.sessionDir, options.cwd)
    : SessionManager.create(options.cwd, options.sessionDir);
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime,
    settingsManager: settings,
    resourceLoader: resources,
    sessionManager,
    tools: ["read", "bash", "edit", "write"],
  });
  return session;
};

/** Owns one SDK session and its fixed credential context. */
export class PiSessionOwner {
  private current: AgentSession | undefined;
  private scope: Scope.Closeable | undefined;
  private closing: Promise<void> | undefined;
  private submitting = false;
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  private constructor() {}

  public static async create(
    options: PiSessionOptions,
    factory?: PiSessionFactory,
  ): Promise<PiSessionOwner> {
    const owner = new PiSessionOwner();
    await owner.acquire(options, factory);
    return owner;
  }

  public get session(): AgentSession {
    if (!this.current || this.closing) throw new Error("Pi session is unavailable");
    return this.current;
  }

  public subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async prompt(
    text: string,
    mode: "prompt" | "steer" | "follow_up",
    onExecutionError: (error: unknown) => void,
  ): Promise<"started" | "queued" | "handled"> {
    if (this.submitting) throw new Error("Pi is already accepting input");
    const session = this.session;
    this.submitting = true;
    try {
      return await submitPiPrompt(session, text, mode, onExecutionError);
    } finally {
      this.submitting = false;
    }
  }

  public async close(): Promise<void> {
    this.closing ??= (async (): Promise<void> => {
      const scope = this.scope;
      this.current = undefined;
      this.scope = undefined;
      try {
        if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
      } finally {
        this.listeners.clear();
      }
    })();
    return this.closing;
  }

  private async acquire(options: PiSessionOptions, factory?: PiSessionFactory): Promise<void> {
    const scope = Scope.makeUnsafe();
    try {
      const session = await Effect.runPromise(
        scopedPiSession(options, factory).pipe(Scope.provide(scope)),
      );
      session.subscribe((event) => {
        for (const listener of this.listeners) listener(event);
      });
      this.scope = scope;
      this.current = session;
    } catch (error) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      throw error;
    }
  }
}
