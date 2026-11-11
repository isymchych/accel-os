import { EventEmitter } from "node:events";
import { mock } from "node:test";

mock.module("node:fs/promises", { exports: { access: async () => {} } });
mock.module("node:module", {
  exports: { createRequire: () => (): string => "/fake/electron" },
});
mock.module("node:child_process", {
  exports: {
    spawn: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
      console.log(`executable:${command}`);
      console.log(`args:${JSON.stringify(args)}`);
      console.log(`cwd:${options.cwd}`);
      console.log(`root:${options.env["ACCEL_OS"]}`);
      console.log(`run-as-node:${options.env["ELECTRON_RUN_AS_NODE"] ?? ""}`);
      const child = Object.assign(new EventEmitter(), { kill: () => true });
      queueMicrotask(() => {
        child.emit("exit", Number(process.env["TEST_ELECTRON_EXIT"] ?? 0), null);
      });
      return child;
    },
  },
});
mock.module("vite", {
  exports: {
    createServer: async () => ({
      listen: async (): Promise<void> => {
        console.log("vite:listening");
      },
      resolvedUrls: { local: ["http://127.0.0.1:5173/"] },
      close: async (): Promise<void> => {
        console.log("vite:closed");
      },
    }),
  },
});

await import("../../../scripts/launch.ts");
