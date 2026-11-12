import { randomBytes, timingSafeEqual } from "node:crypto";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import {
  DirectorySchema,
  EntrySchema,
  ModelSchema,
  OpenSchema,
  PromptSchema,
  TargetSchema,
  ThinkingSchema,
} from "../desktop-api.ts";
import { observeWorkspace } from "./events.ts";
import type { DesktopWorkspace } from "./workspace.ts";

export interface HttpOptions {
  workspace: DesktopWorkspace;
  origins: () => readonly string[];
  bootstrapToken: string;
  cookieName: string;
  shutdown: AbortSignal;
  clientDirectory?: string;
}

function matches(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

/** The sole application transport, shared by browser and Electron clients. */
export function createHttpApp(options: HttpOptions): Hono {
  const app = new Hono();
  const credential = randomBytes(32).toString("hex");
  app.use("*", async (c, next) => {
    const origin = `http://${c.req.header("host") ?? ""}`;
    if (!options.origins().includes(origin)) return c.json({ error: "Untrusted host" }, 403);
    const suppliedOrigin = c.req.header("origin");
    if (
      (suppliedOrigin !== undefined && suppliedOrigin !== origin) ||
      c.req.header("sec-fetch-site") === "cross-site"
    ) {
      return c.json({ error: "Untrusted origin" }, 403);
    }
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Content-Security-Policy", "frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    return next();
  });
  app.use("/api/*", async (c: Context, next) => {
    if (options.shutdown.aborted) return c.json({ error: "Backend is shutting down" }, 503);
    if (c.req.method !== "GET") {
      if (c.req.header("origin") !== `http://${c.req.header("host") ?? ""}`)
        return c.json({ error: "A same-origin request is required" }, 403);
      if (c.req.header("content-type")?.split(";")[0] !== "application/json")
        return c.json({ error: "JSON is required" }, 415);
    }
    const authenticating = c.req.path === "/api/auth" && c.req.method === "POST";
    if (!authenticating && !matches(getCookie(c, options.cookieName), credential))
      return c.json(
        { error: "Open the connection URL printed by the backend to authenticate." },
        401,
      );
    return next();
  });
  app.use(
    "/api/*",
    bodyLimit({
      // Covers worst-case JSON escaping of the existing 100,000-character prompt.
      maxSize: 1024 * 1024,
      onError: (c) => {
        c.header("Connection", "close");
        return c.json({ error: "Request exceeds 1 MiB" }, 413);
      },
    }),
  );
  app.post("/api/auth", (c) => {
    if (!matches(c.req.header("authorization"), `Bearer ${options.bootstrapToken}`))
      return c.json({ error: "Invalid connection token" }, 401);
    setCookie(c, options.cookieName, credential, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/api",
    });
    return c.json(null);
  });
  app.get("/api/auth", (c) => c.json(null));
  app.get("/api/image", async (c) => {
    const query: unknown = c.req.query();
    const schema = Type.Object({ url: Type.String({ maxLength: 8192 }) });
    if (!Value.Check(schema, query)) return c.json({ error: "Invalid image URL" }, 400);
    let url: URL;
    try {
      url = new URL(query.url);
    } catch {
      return c.json({ error: "Invalid image URL" }, 400);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return c.json({ error: "Invalid image URL" }, 400);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (!response.ok || !type?.startsWith("image/") || !response.body)
        return c.json({ error: "Image could not be loaded" }, 502);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) {
          await reader.cancel();
          return c.json({ error: "Image exceeds 16 MiB" }, 413);
        }
        chunks.push(value);
      }
      return new Response(Buffer.concat(chunks), {
        headers: {
          "Content-Type": type,
          "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
        },
      });
    } catch {
      return c.json({ error: "Image could not be loaded" }, 502);
    }
  });
  const workspace = options.workspace;
  app.get("/api/workspace", (c) => c.json(workspace.snapshot()));
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => observeWorkspace(workspace, stream, options.shutdown)),
  );
  function command<T extends TSchema>(
    name: string,
    schema: T,
    action: (request: Static<T>) => unknown,
  ): void {
    app.post(`/api/${name}`, async (c) => {
      let request: unknown;
      try {
        request = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
      if (!Value.Check(schema, request)) return c.json({ error: `Invalid ${name} request` }, 400);
      try {
        return c.json((await action(request)) ?? null);
      } catch (error) {
        // Operation rejections are user-facing; infrastructure exceptions below are not.
        return c.json({ error: error instanceof Error ? error.message : "Operation failed" }, 400);
      }
    });
  }
  command("directory", DirectorySchema, async ({ cwd }) => workspace.directory(cwd));
  command("list", DirectorySchema, async ({ cwd }) => workspace.list(cwd));
  command("create", DirectorySchema, async ({ cwd }) => workspace.create(cwd));
  command("open", OpenSchema, async ({ cwd, path }) => workspace.open(cwd, path));
  command("snapshot", TargetSchema, ({ key }) => workspace.session(key).snapshot());
  command("prompt", PromptSchema, async ({ key, message, mode }) =>
    workspace.session(key).prompt(message, mode),
  );
  command("stop", TargetSchema, async ({ key }) => workspace.session(key).stop());
  command("history", TargetSchema, async ({ key }) => workspace.session(key).history());
  command("navigate", EntrySchema, async ({ key, entryId }) =>
    workspace.session(key).navigate(entryId),
  );
  command("fork", EntrySchema, async ({ key, entryId }) => workspace.fork(key, entryId));
  command("controls", TargetSchema, async ({ key }) => workspace.session(key).controls());
  command("model", ModelSchema, async ({ key, provider, modelId }) =>
    workspace.session(key).model(provider, modelId),
  );
  command("thinking", ThinkingSchema, async ({ key, level }) =>
    workspace.session(key).thinking(level),
  );
  // Never let unknown API routes fall through to static files.
  app.all("/api/*", (c) => c.json({ error: "Unknown API operation" }, 404));
  if (options.clientDirectory) {
    app.get("*", serveStatic({ root: options.clientDirectory }));
  }
  app.onError((_error, c) => c.json({ error: "Backend request failed" }, 500));
  return app;
}
