import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { ReloadControl } from "../../contracts/reload.ts";
import { createApi } from "./api.ts";

const defaultHostname = "127.0.0.1";
const defaultPort = 8787;
const defaultClientDistDirectory = resolve(import.meta.dirname, "../../dist");

export type WorkspaceApplicationOptions = {
  hostname?: string;
  allowedOrigins?: readonly string[];
  clientDistDirectory?: string;
  control?: ReloadControl;
};

export type StartWorkspaceServerOptions = WorkspaceApplicationOptions & {
  port?: number;
};

export type StartedWorkspaceServer = {
  close: () => Promise<void>;
  ready: Promise<AddressInfo>;
};

export function createWorkspaceApplication(options: WorkspaceApplicationOptions = {}): Hono {
  const hostname = options.hostname ?? defaultHostname;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const app = new Hono();
  app.onError((_error, context) =>
    context.json({ code: "internal_error", message: "The request could not be completed." }, 500),
  );

  app.use("*", async (context, next): Promise<Response> => {
    if (!hasExpectedHost(context.req.header("host"), hostname)) {
      return context.json({ code: "invalid_host", message: "Request host is not allowed." }, 400);
    }

    await next();
    return context.res;
  });

  app.use("/api/*", async (context, next): Promise<Response> => {
    if (!isMutation(context.req.method)) {
      await next();
      return context.res;
    }

    const origin = context.req.header("origin");
    if (
      origin !== undefined &&
      !allowedOrigins.has(origin) &&
      origin !== new URL(context.req.url).origin
    ) {
      return context.json(
        { code: "invalid_origin", message: "Request origin is not allowed." },
        403,
      );
    }

    const contentType = context.req.header("content-type");
    if (contentType === undefined || !contentType.toLowerCase().startsWith("application/json")) {
      return context.json(
        { code: "unsupported_media_type", message: "Mutation requests must use JSON." },
        415,
      );
    }

    await next();
    return context.res;
  });

  app.use("/api/*", bodyLimit({ maxSize: 4096 }));
  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });
  app.route("/", createApi(options.control));

  if (options.clientDistDirectory !== undefined) {
    const serveClientFiles = serveStatic({ root: options.clientDistDirectory });
    const clientIndex = readFileSync(resolve(options.clientDistDirectory, "index.html"), "utf8");

    app.use("/*", serveClientFiles);
    app.notFound((context) => {
      if (isApiPath(context.req.path)) {
        return context.json({ code: "not_found", message: "API route was not found." }, 404);
      }

      if (context.req.method !== "GET" && context.req.method !== "HEAD") {
        return context.json({ code: "not_found", message: "Route was not found." }, 404);
      }

      return context.html(clientIndex);
    });
  } else {
    app.notFound((context) =>
      context.json({ code: "not_found", message: "Route was not found." }, 404),
    );
  }

  return app;
}

export function startWorkspaceServer(
  options: StartWorkspaceServerOptions = {},
): StartedWorkspaceServer {
  const hostname = options.hostname ?? defaultHostname;
  const port =
    options.port ?? readPort(process.env["WORKSPACE_PORT"], defaultPort, "WORKSPACE_PORT");
  const clientDistDirectory = requireClientDistDirectory(
    options.clientDistDirectory ??
      process.env["WORKSPACE_CLIENT_DIST"] ??
      defaultClientDistDirectory,
  );
  const allowedOrigins = options.allowedOrigins ?? [];
  const appOptions: WorkspaceApplicationOptions = { hostname, allowedOrigins };
  appOptions.clientDistDirectory = clientDistDirectory;
  if (options.control !== undefined) appOptions.control = options.control;

  const app = createWorkspaceApplication(appOptions);

  const ready = Promise.withResolvers<AddressInfo>();
  const server = serve({ fetch: app.fetch, hostname, port }, ready.resolve);
  server.once("error", ready.reject);

  return {
    close: async () => closeServer(server),
    ready: ready.promise,
  };
}

async function closeServer(server: ReturnType<typeof serve>): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
        return;
      }

      rejectClose(error);
    });
  });
}

function hasExpectedHost(host: string | undefined, hostname: string): boolean {
  if (host === undefined) {
    return false;
  }

  try {
    const parsedHost = new URL(`http://${host}`);
    return (
      parsedHost.hostname === hostname &&
      parsedHost.username.length === 0 &&
      parsedHost.password.length === 0 &&
      parsedHost.pathname === "/"
    );
  } catch {
    return false;
  }
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function readPort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return port;
}

function requireClientDistDirectory(directory: string): string {
  if (!existsSync(resolve(directory, "index.html"))) {
    throw new Error(`Client assets are missing from ${directory}. Run pnpm run build first.`);
  }

  return directory;
}
