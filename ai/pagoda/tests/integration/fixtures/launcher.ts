import { EventEmitter } from "node:events";
import { mock } from "node:test";

mock.module("node:module", {
  exports: { createRequire: () => (): string => "/fake/electron" },
});
mock.module("node:child_process", {
  exports: {
    spawn: (
      command: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => {
      console.log(`executable:${command}`);
      console.log(`args:${JSON.stringify(args)}`);
      console.log(`cwd:${options.cwd}`);
      console.log(`root:${options.env?.["ACCEL_OS"]}`);
      const isBackend = args[0]?.endsWith("backend/entry.js") === true;
      const isServerFixture = process.env["TEST_LAUNCHER_TARGET"] === "server";
      const child = Object.assign(new EventEmitter(), {
        unref: () => {},
        kill: () => {
          console.log(`killed:${isBackend ? "backend" : "client"}`);
          queueMicrotask(() => {
            child.emit("exit", 0, null);
          });
          return true;
        },
      });
      queueMicrotask(() => {
        if (isBackend) {
          if (process.env["TEST_BACKEND_FAIL"] === "1") {
            child.emit("exit", 1, null);
            return;
          }
          child.emit("message", {
            type: "ready",
            url: `http://127.0.0.1:4317/#token=${"a".repeat(64)}`,
          });
          if (process.env["TEST_STOP_ON_READY"] === "1") process.emit("SIGTERM");
          if (isServerFixture) child.emit("exit", 0, null);
        } else {
          child.emit("exit", Number(process.env["TEST_ELECTRON_EXIT"] ?? 0), null);
          if (process.env["TEST_BROWSER"] === "1") {
            queueMicrotask(() => {
              process.emit("SIGINT");
            });
          }
        }
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

await import(
  process.env["TEST_LAUNCHER_TARGET"] === "server"
    ? "../../../scripts/server.ts"
    : "../../../scripts/launch.ts"
);
