import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";

import { NodeFileSystem, NodeHttpServer } from "@effect/platform-node";
import { Cause, Effect, Exit, FileSystem, Scope } from "effect";

import { createHttpApp } from "./http.ts";
import type { PiSessionOptions, PiSessionFactory } from "./pi/session.ts";
import { SessionMetadataStore } from "./session-metadata.ts";
import { readInactivityHours } from "./settings.ts";
import { DesktopWorkspace } from "./workspace.ts";

export interface BackendOptions {
  pi: PiSessionOptions;
  sessionFactory?: PiSessionFactory;
  port?: number;
  clientDirectory?: string;
  developmentOrigin?: "http://127.0.0.1:5173";
  signal?: AbortSignal;
}
export interface Backend {
  origin: string;
  connectionUrl: string;
  close(): Promise<void>;
}

/** The launcher-facing Promise boundary owns one Effect lifetime for HTTP and SDK resources. */
export async function startBackend(options: BackendOptions): Promise<Backend> {
  options.signal?.throwIfAborted();
  const scope = Scope.makeUnsafe();
  const server = createServer();
  const shutdown = new AbortController();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async (): Promise<void> => {
      shutdown.abort();
      options.signal?.removeEventListener("abort", abort);
      // A closed/slow observer must not hold process shutdown hostage.
      server.closeAllConnections();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    })();
    return closing;
  };
  const abort = (): void => {
    // Startup and the launcher also await close() to report cleanup failures.
    void close().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* Scope.addFinalizer(
          scope,
          Effect.callback<undefined>((resume) => {
            if (!server.listening) {
              resume(Effect.succeed(undefined));
              return;
            }
            server.close((error) => {
              resume(error ? Effect.die(error) : Effect.succeed(undefined));
            });
          }),
        );
        const fs = yield* FileSystem.FileSystem;
        const inactivityHours = yield* readInactivityHours(
          path.join(options.pi.agentDir, "pagoda-settings.json"),
        );
        yield* Effect.tryPromise({
          try: async () => {
            server.listen({
              port: options.port ?? 4317,
              host: "127.0.0.1",
              signal: shutdown.signal,
            });
            await once(server, "listening", { signal: shutdown.signal });
          },
          catch: (error) => error,
        });
        const address = server.address();
        if (address === null || typeof address === "string")
          return yield* Effect.fail(new Error("Missing backend address"));
        const origin = `http://127.0.0.1:${address.port}`;
        const workspace = yield* DesktopWorkspace.make(
          options.pi,
          new SessionMetadataStore(fs, path.join(options.pi.agentDir, "pagoda-state.json")),
          inactivityHours,
          options.sessionFactory,
        );
        const token = randomBytes(32).toString("hex");
        const httpEffect = yield* createHttpApp({
          workspace,
          origins: () => [
            origin,
            ...(options.developmentOrigin ? [options.developmentOrigin] : []),
          ],
          bootstrapToken: token,
          cookieName: `pagoda_${randomBytes(8).toString("hex")}`,
          shutdown: shutdown.signal,
          ...(options.clientDirectory ? { clientDirectory: options.clientDirectory } : {}),
        });
        const handler = yield* NodeHttpServer.makeHandler(httpEffect, { scope });
        server.on("request", handler);
        return {
          origin,
          connectionUrl: `${options.developmentOrigin ?? origin}/#token=${token}`,
          close,
        };
      }).pipe(
        Effect.provide(NodeHttpServer.layerHttpServices),
        Effect.provide(NodeFileSystem.layer),
        Scope.provide(scope),
      ),
      { signal: options.signal },
    );
    if (Exit.isFailure(result)) {
      if (options.signal?.aborted && Cause.hasInterruptsOnly(result.cause)) {
        options.signal.throwIfAborted();
      }
      throw Cause.squash(result.cause);
    }
    return result.value;
  } catch (error) {
    await close();
    throw error;
  }
}
