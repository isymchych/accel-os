import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { Effect, Layer, type FileSystem, type Path, type Scope } from "effect";
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  type Etag,
  type HttpPlatform,
  type HttpServerError,
} from "effect/http";

import { workspaceApi } from "./api.ts";
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

function error(message: string, status: number): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status });
}

async function proxyImage(raw: string | null): Promise<Response> {
  if (!raw || raw.length > 8192)
    return Response.json({ error: "Invalid image URL" }, { status: 400 });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return Response.json({ error: "Invalid image URL" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    return Response.json({ error: "Invalid image URL" }, { status: 400 });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!response.ok || !type?.startsWith("image/") || !response.body)
      return Response.json({ error: "Image could not be loaded" }, { status: 502 });
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16 * 1024 * 1024) {
        await reader.cancel();
        return Response.json({ error: "Image exceeds 16 MiB" }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    return new Response(Buffer.concat(chunks), {
      headers: {
        "Content-Type": type,
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      },
    });
  } catch {
    return Response.json({ error: "Image could not be loaded" }, { status: 502 });
  }
}

/** Effect routes and the shared local-client security policy. */
export function createHttpApp(
  options: HttpOptions,
): Effect.Effect<
  Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    HttpServerError.HttpServerError,
    HttpPlatform.HttpPlatform | HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  never,
  FileSystem.FileSystem | Etag.Generator | HttpPlatform.HttpPlatform | Path.Path | Scope.Scope
> {
  const credential = randomBytes(32).toString("hex");
  const authPost = HttpRouter.add("POST", "/api/auth", (request) =>
    Effect.sync(() => {
      if (!matches(request.headers["authorization"], `Bearer ${options.bootstrapToken}`))
        return error("Invalid connection token", 401);
      return HttpServerResponse.setCookieUnsafe(
        HttpServerResponse.jsonUnsafe(null),
        options.cookieName,
        credential,
        { httpOnly: true, sameSite: "strict", path: "/api" },
      );
    }),
  );
  const authGet = HttpRouter.add("GET", "/api/auth", HttpServerResponse.jsonUnsafe(null));
  const image = HttpRouter.add("GET", "/api/image", (request) =>
    Effect.promise(async () =>
      HttpServerResponse.fromWeb(
        await proxyImage(new URL(request.url, "http://localhost").searchParams.get("url")),
      ),
    ),
  );
  const events = HttpRouter.add("GET", "/api/events", () =>
    Effect.sync(() => observeWorkspace(options.workspace.observations)),
  );
  const unknownApi = HttpRouter.add("*", "/api/*", error("Unknown API operation", 404));
  const asset = (
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpPlatform.HttpPlatform> =>
    Effect.gen(function* () {
      if (!options.clientDirectory) return HttpServerResponse.empty({ status: 404 });
      let name: string;
      try {
        name = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      } catch {
        return HttpServerResponse.empty({ status: 400 });
      }
      const root = path.resolve(options.clientDirectory);
      const file = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`))
        return HttpServerResponse.empty({ status: 404 });
      return yield* HttpServerResponse.file(file).pipe(
        Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
      );
    });
  const assets = Layer.merge(HttpRouter.add("GET", "/", asset), HttpRouter.add("GET", "/*", asset));
  const routes = Layer.mergeAll(
    workspaceApi(options.workspace),
    authPost,
    authGet,
    image,
    events,
    unknownApi,
    assets,
  );
  return Effect.map(HttpRouter.toHttpEffect(routes), (router) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      yield* HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(
          HttpServerResponse.setHeaders(response, {
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "cross-origin-resource-policy": "same-origin",
            "content-security-policy":
              response.headers["content-security-policy"] ?? "frame-ancestors 'none'",
            "cache-control": "no-store",
          }),
        ),
      );
      const origin = `http://${request.headers["host"] ?? ""}`;
      if (!options.origins().includes(origin)) return error("Untrusted host", 403);
      const suppliedOrigin = request.headers["origin"];
      if (
        (suppliedOrigin !== undefined && suppliedOrigin !== origin) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        return error("Untrusted origin", 403);
      }
      const pathname = new URL(request.url, origin).pathname;
      if (pathname.startsWith("/api/")) {
        if (options.shutdown.aborted) return error("Backend is shutting down", 503);
        if (request.method !== "GET") {
          if (suppliedOrigin !== origin) return error("A same-origin request is required", 403);
          if (request.headers["content-type"]?.split(";")[0] !== "application/json")
            return error("JSON is required", 415);
        }
        const authenticating = pathname === "/api/auth" && request.method === "POST";
        if (!authenticating && !matches(request.cookies[options.cookieName], credential))
          return error("Open the connection URL printed by the backend to authenticate.", 401);
      }
      return yield* router;
    }),
  );
}
