import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import { fakePiOptions, fakeSessionFactory } from "./fixtures/helpers.ts";

let server: http.Server | undefined;
mock.module("node:http", {
  exports: {
    ...http,
    createServer: (...args: Parameters<typeof http.createServer>) => {
      server = http.createServer(...args);
      return server;
    },
  },
});
const { startBackend } = await import("../../src/backend/server.ts");

for (const phase of ["binding", "SDK initialization"] as const) {
  // The mocked server is shared with the module factory.
  // eslint-disable-next-line no-loop-func
  test(`cancellation during ${phase} closes the listener and releases acquired SDK resources`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "pagoda-server-startup-"));
    const controller = new AbortController();
    let acquired = false;
    t.after(async () => {
      if (server?.listening)
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      await rm(root, { recursive: true, force: true });
    });
    const starting = startBackend({
      port: 0,
      signal: controller.signal,
      pi: fakePiOptions(root),
      sessionFactory: async (options) => {
        acquired = true;
        controller.abort(new Error("Startup cancelled"));
        return fakeSessionFactory(options);
      },
    });
    if (phase === "binding") controller.abort(new Error("Startup cancelled"));
    await assert.rejects(starting);
    assert.ok(server);
    assert.equal(server.listening, false);
    assert.equal(acquired, phase === "SDK initialization");
    if (phase === "SDK initialization")
      assert.equal(await readFile(path.join(root, "closed"), "utf8"), "clean");
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  });
}
