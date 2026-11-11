import assert from "node:assert/strict";
import path from "node:path";
import { mock } from "node:test";

import type { Backend, BackendOptions } from "../../../src/backend/server.ts";

let closeCalls = 0;
mock.module(path.resolve(import.meta.dirname, "../../../src/backend/server.ts"), {
  exports: {
    startBackend: async (options: BackendOptions): Promise<Backend> => {
      console.log(`executable:${options.pi.executable}`);
      console.log(`args:${JSON.stringify(options.pi.args)}`);
      console.log(`cwd:${options.pi.cwd}`);
      console.log(`port:${options.port}`);
      console.log(`renderer:${options.developmentOrigin ?? "built"}`);
      return {
        connectionUrl: "http://127.0.0.1:4317/#token=fixture",
        origin: "http://127.0.0.1:4317",
        close: async (): Promise<void> => {
          closeCalls += 1;
          await Promise.resolve();
        },
      };
    },
  },
});
await import("../../../src/backend/entry.ts");
if (process.env["TEST_REPEAT_SIGNALS"] === "1") {
  assert.equal(process.emit("SIGINT"), true);
  assert.equal(process.emit("SIGTERM"), true);
  assert.equal(process.emit("SIGTERM"), true, "Keep handling signals until shutdown finishes");
  assert.equal(closeCalls, 1, "Signal forwarding must initiate cleanup only once");
}
