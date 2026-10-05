import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspaceApplication, startWorkspaceServer } from "../../server/app/server.ts";

test("server rejects hostile hosts, origins, and non-JSON mutations", async () => {
  const app = createWorkspaceApplication({
    allowedOrigins: ["http://127.0.0.1:5173"],
  });

  const hostileHost = await app.request("/api/health", {
    headers: { host: "example.test" },
  });
  assert.equal(hostileHost.status, 400);

  const hostileOrigin = await app.request("/api/diagnostic", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787",
      origin: "http://example.test",
    },
    body: JSON.stringify({ message: "hello" }),
  });
  assert.equal(hostileOrigin.status, 403);

  const nonJsonMutation = await app.request("/api/diagnostic", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      host: "127.0.0.1:8787",
      origin: "http://127.0.0.1:5173",
    },
    body: "hello",
  });
  assert.equal(nonJsonMutation.status, 415);
});

test("production server serves the client and keeps unknown API routes as JSON", async (context) => {
  const clientDistDirectory = await mkdtemp(join(tmpdir(), "ai-workspace-client-"));
  await writeFile(join(clientDistDirectory, "index.html"), "<main>workspace shell</main>");
  await writeFile(join(clientDistDirectory, "app.js"), "console.log('workspace');");
  context.after(async () => rm(clientDistDirectory, { force: true, recursive: true }));

  const workspaceServer = startWorkspaceServer({
    clientDistDirectory,
    mode: "production",
    port: 0,
  });
  context.after(async () => workspaceServer.close());
  const address = await workspaceServer.ready;
  const origin = `http://127.0.0.1:${address.port}`;

  const shellResponse = await fetch(`${origin}/conversations/example`);
  assert.equal(shellResponse.status, 200);
  assert.equal(await shellResponse.text(), "<main>workspace shell</main>");

  const assetResponse = await fetch(`${origin}/app.js`);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get("content-type") ?? "", /javascript/);

  const apiResponse = await fetch(`${origin}/api/unknown`);
  assert.equal(apiResponse.status, 404);
  assert.deepEqual(await apiResponse.json(), {
    code: "not_found",
    message: "API route was not found.",
  });
});

test("graceful shutdown releases the listening port", async () => {
  const workspaceServer = startWorkspaceServer({ mode: "development", port: 0 });
  const address = await workspaceServer.ready;

  await workspaceServer.close();
  await listenAndClose(address.port);
});

async function listenAndClose(port: number): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const server = createServer();
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error === undefined) {
          resolveListen();
          return;
        }

        rejectListen(error);
      });
    });
  });
}
