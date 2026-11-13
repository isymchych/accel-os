import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { startBackend } from "../../src/backend/server.ts";
import { PagodaApi } from "../../src/contracts/api.ts";
import { OperationFailed, OperationRejected } from "../../src/contracts/errors.ts";
import { SnapshotSchema, WorkspaceSchema } from "../../src/contracts/index.ts";
import { fakePiOptions, fakeSessionFactory, setupFakePi } from "./fixtures/helpers.ts";

test("HTTP distinguishes rejected commands from operational failures, including workspace reads", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-http-errors-"));
  await setupFakePi(directory);
  const stateFile = path.join(fakePiOptions(directory).agentDir, "pagoda-state.json");
  const backend = await startBackend({
    port: 0,
    pi: fakePiOptions(directory),
    sessionFactory: async (options) => {
      const sdk = await fakeSessionFactory(options);
      sdk.modelRuntime.getAvailable = async (): Promise<never> => {
        throw new Error("Model discovery failed");
      };
      return sdk;
    },
  });
  t.after(async () => {
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  });
  const token = new URLSearchParams(new URL(backend.connectionUrl).hash.slice(1)).get("token");
  assert.ok(token);
  const auth = await fetch(`${backend.origin}/api/auth`, {
    method: "POST",
    headers: {
      origin: backend.origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const cookie = auth.headers.getSetCookie()[0]?.split(";")[0];
  assert.ok(cookie);
  const response = await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } });
  const workspace: unknown = await response.json();
  assert.ok(Schema.is(WorkspaceSchema)(workspace));
  const post = (operation: string, payload: unknown): Promise<Response> =>
    fetch(`${backend.origin}/api/${operation}`, {
      method: "POST",
      headers: { origin: backend.origin, "content-type": "application/json", cookie },
      body: JSON.stringify(payload),
    });
  for (const [operation, payload, message] of [
    [
      "model",
      { key: workspace.initialKey, provider: "missing", modelId: "missing" },
      "Unknown Pi model",
    ],
    [
      "prompt",
      { key: workspace.initialKey, message: "reject", mode: "prompt" },
      "Rejected test prompt",
    ],
  ] as const) {
    const rejected = await post(operation, payload);
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: message });
  }
  const failed = await post("controls", { key: workspace.initialKey });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Model discovery failed" });

  const missingDirectory = await post("directory", { cwd: path.join(directory, "missing") });
  assert.equal(missingDirectory.status, 400);

  const client = await Effect.runPromise(
    HttpApiClient.make(PagodaApi, {
      baseUrl: backend.origin,
      transformClient: (httpClient) =>
        HttpClient.mapRequest(
          httpClient,
          HttpClientRequest.setHeaders({ cookie, origin: backend.origin }),
        ),
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const rejection = await Effect.runPromise(
    client.workspace
      .model({
        payload: { key: workspace.initialKey, provider: "missing", modelId: "missing" },
      })
      .pipe(Effect.flip),
  );
  assert.ok(rejection instanceof OperationRejected);
  assert.equal(rejection.message, "Unknown Pi model");
  const failure = await Effect.runPromise(
    client.workspace.controls({ payload: { key: workspace.initialKey } }).pipe(Effect.flip),
  );
  assert.ok(failure instanceof OperationFailed);
  assert.equal(failure.message, "Model discovery failed");

  await writeFile(stateFile, JSON.stringify({ invalid: "metadata" }));
  const unreadable = await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } });
  assert.equal(unreadable.status, 500);
  assert.deepEqual(await unreadable.json(), { error: "Invalid Pagoda session metadata" });
  await writeFile(stateFile, "{broken");
  const invalidJson = await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } });
  assert.equal(invalidJson.status, 500);
  assert.deepEqual(await invalidJson.json(), { error: "Invalid Pagoda session metadata" });
});

test("authenticated HTTP preserves execution independently of observers and cleans up on shutdown", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-http-"));
  await setupFakePi(directory);
  const backend = await startBackend({
    port: 0,
    pi: fakePiOptions(directory),
    sessionFactory: fakeSessionFactory,
  });
  t.after(async () => {
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  });
  const token = new URLSearchParams(new URL(backend.connectionUrl).hash.slice(1)).get("token");
  assert.ok(token);
  const post = async (operation: string, request: unknown, cookie = ""): Promise<Response> =>
    fetch(`${backend.origin}/api/${operation}`, {
      method: "POST",
      headers: { origin: backend.origin, "content-type": "application/json", cookie },
      body: JSON.stringify(request),
    });
  const unauthenticated = await fetch(`${backend.origin}/api/workspace`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await fetch(`${backend.origin}/api/events`)).status, 401);
  assert.equal((await post("prompt", {})).status, 401);
  assert.equal(
    (
      await fetch(`${backend.origin}/api/auth`, {
        method: "POST",
        headers: {
          origin: "http://hostile.invalid",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      })
    ).status,
    403,
  );
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      `${backend.origin}/api/workspace`,
      { headers: { host: "hostile.invalid" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.once("error", reject);
    request.end();
  });
  assert.equal(hostileHostStatus, 403);
  const auth = await fetch(`${backend.origin}/api/auth`, {
    method: "POST",
    headers: {
      origin: backend.origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(auth.status, 200);
  const setCookie = auth.headers.getSetCookie()[0];
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/u);
  assert.match(setCookie, /SameSite=Strict/u);
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie);
  let forwardedCookie: string | undefined;
  let forwardedReferrer: string | undefined;
  const imageServer = createServer((request, response) => {
    forwardedCookie = request.headers.cookie;
    forwardedReferrer = request.headers.referer;
    response.writeHead(200, { "content-type": "image/png" });
    response.end("image bytes");
  });
  await new Promise<void>((resolve) => {
    imageServer.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        imageServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  );
  const address = imageServer.address();
  assert.ok(address !== null && typeof address !== "string");
  const imageUrl = `${backend.origin}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${address.port}/image`)}`;
  assert.equal((await fetch(imageUrl)).status, 401);
  const imageResponse = await fetch(imageUrl, {
    headers: { cookie, referer: "http://private.invalid/" },
  });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.equal(await imageResponse.text(), "image bytes");
  assert.equal(forwardedCookie, undefined);
  assert.equal(forwardedReferrer, undefined);
  assert.equal(
    (
      await fetch(`${backend.origin}/api/image?url=file%3A%2F%2F%2Fetc%2Fpasswd`, {
        headers: { cookie },
      })
    ).status,
    400,
  );
  const request = async (operation: string, payload: unknown): Promise<unknown> => {
    const response = await post(operation, payload, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const workspace: unknown = await (
    await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } })
  ).json();
  assert.ok(Schema.is(WorkspaceSchema)(workspace));
  const workspaceResponse = await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } });
  assert.equal(workspaceResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(workspaceResponse.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(workspaceResponse.headers.get("content-security-policy"), "frame-ancestors 'none'");
  assert.equal(
    (await fetch(`${backend.origin}/api/not-an-operation`, { headers: { cookie } })).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${backend.origin}/api/stop`, {
        method: "POST",
        headers: { origin: backend.origin, "content-type": "text/plain", cookie },
        body: "{}",
      })
    ).status,
    415,
  );
  const key = workspace.initialKey;
  for (const invalid of [{}, { key: "" }, { key, extra: true }])
    assert.equal((await post("stop", invalid, cookie)).status, 400);
  for (const [operation, payload] of [
    ["prompt", { key: "missing-owner", mode: "prompt", message: "hello" }],
    ["history", { key: "missing-owner" }],
    ["fork", { key: "missing-owner", entryId: "missing-entry" }],
  ] as const) {
    const response = await post(operation, payload, cookie);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "This session is unavailable" });
  }
  const invalidRequest = await post("stop", {}, cookie);
  assert.equal(invalidRequest.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(
    (await post("prompt", { key, mode: "prompt", message: "x".repeat(100_001) }, cookie)).status,
    400,
  );
  assert.equal(
    (await post("prompt", { key, mode: "prompt", message: " \n " }, cookie)).status,
    400,
  );
  const largeRequest = await fetch(`${backend.origin}/api/list-all`, {
    method: "POST",
    headers: { origin: backend.origin, "content-type": "application/json", cookie },
    body: JSON.stringify({ extra: "x".repeat(1024 * 1024) }),
  });
  assert.equal(largeRequest.status, 200);
  await largeRequest.text();
  assert.equal(
    (
      await fetch(`${backend.origin}/api/stop`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ key }),
      })
    ).status,
    403,
  );

  const observe = async (): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const response = await fetch(`${backend.origin}/api/events`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/u);
    assert.ok(response.body);
    return response.body.getReader();
  };
  const first = await observe();
  const second = await observe();
  await request("prompt", { key, mode: "prompt", message: "hold" });
  const untilRunning = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"state":"running"')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += decoder.decode(chunk.value, { stream: true });
    }
  };
  await Promise.all([untilRunning(first), untilRunning(second)]);
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  await Promise.all([first.cancel(), second.cancel()]);
  process.kill(toolPid, 0);
  const snapshot = await request("snapshot", { key });
  assert.ok(Schema.is(SnapshotSchema)(snapshot));
  assert.equal(snapshot.execution, "running");
  const reconnected = await observe();
  await untilRunning(reconnected);
  await reconnected.cancel();
  await request("stop", { key });
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
  await request("prompt", { key, mode: "prompt", message: "hold" });
  const streamAtShutdown = await observe();
  await untilRunning(streamAtShutdown);
  const nextToolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  await backend.close();
  await streamAtShutdown.cancel().catch(() => {});
  assert.equal(await readFile(path.join(directory, "closed"), "utf8"), "clean");
  assert.throws(() => process.kill(nextToolPid, 0), { code: "ESRCH" });
});
