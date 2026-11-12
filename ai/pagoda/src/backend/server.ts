import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";

import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Exit, Scope } from "effect";

import { createHttpApp } from "./http.ts";
import type { PiLaunch } from "./rpc.ts";
import { SessionMetadataStore } from "./session-metadata.ts";
import { readInactivityHours } from "./settings.ts";
import { DesktopWorkspace } from "./workspace.ts";

export interface BackendOptions {
  pi: PiLaunch;
  port?: number;
  clientDirectory?: string;
  developmentOrigin?: "http://127.0.0.1:5173";
  signal?: AbortSignal;
  stateFile?: string;
  settingsFile?: string;
}
export interface Backend {
  origin: string;
  connectionUrl: string;
  close(): Promise<void>;
}

/** One foreground backend owns execution; clients only observe and send commands. */
export async function startBackend(options: BackendOptions): Promise<Backend> {
  options.signal?.throwIfAborted();
  const inactivityHours = await readInactivityHours(options.settingsFile);
  const metadata = new SessionMetadataStore(options.stateFile);
  const workspace = new DesktopWorkspace(options.pi, metadata, inactivityHours);
  const shutdown = new AbortController();
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const scope = Scope.makeUnsafe();
  const app = createHttpApp({
    workspace,
    origins: () => [origin, ...(options.developmentOrigin ? [options.developmentOrigin] : [])],
    bootstrapToken: token,
    cookieName: `pagoda_${randomBytes(8).toString("hex")}`,
    shutdown: shutdown.signal,
    ...(options.clientDirectory ? { clientDirectory: options.clientDirectory } : {}),
  });
  let handle: RequestListener;
  try {
    handle = await Effect.runPromise(
      Effect.flatMap(app, (httpEffect) => NodeHttpServer.makeHandler(httpEffect, { scope })).pipe(
        Effect.provide(NodeHttpServer.layerHttpServices),
        Scope.provide(scope),
      ),
    );
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
  const server = createServer(handle);
  await Effect.runPromise(
    Scope.addFinalizer(
      scope,
      Effect.callback<undefined>((resume) => {
        if (!server.listening) {
          resume(Effect.succeed(undefined));
          return;
        }
        server.close((error) => {
          if (error) resume(Effect.die(error));
          else resume(Effect.succeed(undefined));
        });
      }),
    ),
  );
  let closing: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    closing ??= (async (): Promise<void> => {
      shutdown.abort();
      options.signal?.removeEventListener("abort", abort);
      // A closed/slow observer must not hold process shutdown hostage.
      server.closeAllConnections();
      await Promise.all([workspace.close(), Effect.runPromise(Scope.close(scope, Exit.void))]);
    })();
    return closing;
  };
  const abort = (): void => {
    // During startup the caller also awaits this cleanup through the catch path.
    // After startup the entry point awaits close() to report shutdown failures.
    void close().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    server.listen({
      port: options.port ?? 4317,
      host: "127.0.0.1",
      signal: shutdown.signal,
    });
    await once(server, "listening", { signal: shutdown.signal });
    options.signal?.throwIfAborted();
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing backend address");
    origin = `http://127.0.0.1:${address.port}`;
    await workspace.start();
    options.signal?.throwIfAborted();
    return {
      origin,
      connectionUrl: `${options.developmentOrigin ?? origin}/#token=${token}`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
