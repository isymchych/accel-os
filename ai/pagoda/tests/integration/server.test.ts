import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import { once } from "node:events";
import * as http from "node:http";
import test, { mock } from "node:test";

let server: http.Server | undefined;
let onSpawn: () => void = () => {};
const children: childProcess.ChildProcess[] = [];
mock.module("node:http", {
  exports: {
    ...http,
    createServer: (...args: Parameters<typeof http.createServer>) => {
      server = http.createServer(...args);
      return server;
    },
  },
});
mock.module("node:child_process", {
  exports: {
    ...childProcess,
    spawn: (...args: Parameters<typeof childProcess.spawn>) => {
      const child = childProcess.spawn(...args);
      children.push(child);
      queueMicrotask(onSpawn);
      return child;
    },
  },
});
const { startBackend } = await import("../../src/backend/server.ts");

(["binding", "Pi initialization"] as const).forEach((phase) => {
  test(`cancellation during ${phase} closes the listener and Pi child`, async (t) => {
    children.length = 0;
    const controller = new AbortController();
    const reason = new Error("Startup cancelled");
    onSpawn = (): void => {
      if (phase === "Pi initialization") controller.abort(reason);
    };
    t.after(async () => {
      // Also clean up the deliberately reproduced leak when running against a broken build.
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const closed = once(child, "close");
          child.kill("SIGKILL");
          await closed;
        }),
      );
      if (server?.listening) {
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    });
    const starting = startBackend({
      port: 0,
      signal: controller.signal,
      pi: {
        executable: process.execPath,
        args: ["-e", "process.stdin.resume()"],
        cwd: process.cwd(),
        env: {},
      },
    });
    if (phase === "binding") controller.abort(reason);
    await assert.rejects(starting);
    assert.ok(server);
    assert.equal(server.listening, false);
    if (phase === "binding") assert.equal(children.length, 0);
    else assert.equal(children.length, 1);
    for (const child of children) {
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    }
    // Rebinding the same listener also checks that no pending bind survives cleanup.
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  });
});
