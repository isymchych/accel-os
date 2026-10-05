import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { api } from "./api.ts";

const defaultHostname = "127.0.0.1";
const defaultPort = 8787;
const defaultVitePort = 5173;
const defaultClientDistDirectory = resolve(import.meta.dirname, "../../dist");

export type WorkspaceServerMode = "development" | "production";

export type WorkspaceApplicationOptions = {
  hostname?: string;
  allowedOrigins?: readonly string[];
  clientDistDirectory?: string;
};

export type StartWorkspaceServerOptions = WorkspaceApplicationOptions & {
  mode?: WorkspaceServerMode;
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
    if (origin !== undefined && !allowedOrigins.has(origin)) {
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

  app.route("/", api);

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
  const mode = options.mode ?? readMode(process.env["WORKSPACE_MODE"]);
  const hostname = options.hostname ?? defaultHostname;
  const port =
    options.port ?? readPort(process.env["WORKSPACE_PORT"], defaultPort, "WORKSPACE_PORT");
  const clientOrigin = `http://${hostname}:${readPort(
    process.env["WORKSPACE_VITE_PORT"],
    defaultVitePort,
    "WORKSPACE_VITE_PORT",
  )}`;
  const clientDistDirectory =
    mode === "production"
      ? requireClientDistDirectory(options.clientDistDirectory ?? defaultClientDistDirectory)
      : undefined;
  const allowedOrigins = options.allowedOrigins ?? [clientOrigin, `http://${hostname}:${port}`];
  const appOptions: WorkspaceApplicationOptions = { hostname, allowedOrigins };
  if (clientDistDirectory !== undefined) {
    appOptions.clientDistDirectory = clientDistDirectory;
  }

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

function readMode(value: string | undefined): WorkspaceServerMode {
  if (value === undefined || value === "production") {
    return "production";
  }

  if (value === "development") {
    return "development";
  }

  throw new Error("WORKSPACE_MODE must be either development or production.");
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
    throw new Error(`Client assets are missing from ${directory}. Run npm run build first.`);
  }

  return directory;
}
