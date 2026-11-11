import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Value } from "typebox/value";

import { startBackend } from "../../src/backend/server.ts";
import { SnapshotSchema, WorkspaceSchema } from "../../src/desktop-api.ts";
import { fakePiLaunch } from "./fixtures/helpers.ts";

test("authenticated HTTP preserves execution independently of observers and cleans up on shutdown", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagoda-http-"));
  const backend = await startBackend({
    port: 0,
    pi: fakePiLaunch(directory),
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
  const request = async (operation: string, payload: unknown): Promise<unknown> => {
    const response = await post(operation, payload, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const workspace: unknown = await (
    await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } })
  ).json();
  assert.ok(Value.Check(WorkspaceSchema, workspace));
  const key = workspace.initialKey;
  for (const invalid of [{}, { key: "" }, { key, extra: true }])
    assert.equal((await post("stop", invalid, cookie)).status, 400);
  assert.equal(
    (await post("prompt", { key, mode: "prompt", message: "x".repeat(100_001) }, cookie)).status,
    400,
  );
  assert.equal(
    (await post("prompt", { key, mode: "prompt", message: " \n " }, cookie)).status,
    400,
  );
  const oversized = await fetch(`${backend.origin}/api/prompt`, {
    method: "POST",
    headers: { origin: backend.origin, "content-type": "application/json", cookie },
    body: JSON.stringify({ key, mode: "prompt", message: "x".repeat(1024 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  await oversized.text();
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
  assert.ok(Value.Check(SnapshotSchema, snapshot));
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

test(
  "cancelling backend startup disposes a Pi child that has not acknowledged readiness",
  { timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "pagoda-startup-"));
    const marker = path.join(directory, "started");
    const controller = new AbortController();
    const started = Promise.withResolvers<undefined>();
    const watcher = watch(directory, (_event, name) => {
      if (name === "started") started.resolve(undefined);
    });
    t.after(async () => {
      controller.abort();
      watcher.close();
      await rm(directory, { recursive: true, force: true });
    });
    const rejected = assert.rejects(
      startBackend({
        port: 0,
        signal: controller.signal,
        pi: {
          executable: process.execPath,
          args: [
            "-e",
            `const fs = require("node:fs");
           fs.writeFileSync(process.env.STARTED + ".tmp", String(process.pid));
           fs.renameSync(process.env.STARTED + ".tmp", process.env.STARTED);
           process.stdin.on("end", () => process.exit(0));
           process.stdin.resume();`,
          ],
          cwd: directory,
          env: { STARTED: marker },
        },
      }),
      /Pi exited|closed|abort/iu,
    );
    await started.promise;
    const pid = Number(await readFile(marker, "utf8"));
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);
