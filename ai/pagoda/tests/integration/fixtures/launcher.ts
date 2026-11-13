import { EventEmitter } from "node:events";
import { mock } from "node:test";

import type { BackendOptions } from "../../../src/backend/server.ts";

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
      const child = Object.assign(new EventEmitter(), {
        unref: () => {},
        kill: () => {
          console.log("killed:client");
          queueMicrotask(() => {
            child.emit("exit", 0, null);
          });
          return true;
        },
      });
      queueMicrotask(() => {
        if (
          process.env["TEST_BROWSER"] === "1" ||
          process.env["TEST_LAUNCHER_TARGET"] === "server"
        ) {
          process.emit("SIGINT");
        } else {
          child.emit("exit", Number(process.env["TEST_ELECTRON_EXIT"] ?? 0), null);
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
      close: async (): Promise<void> => {
        console.log("vite:closed");
      },
    }),
  },
});

const { runApplication, backendOptions } = await import("../../../scripts/application.ts");
mock.module("../../../scripts/application.ts", {
  exports: {
    backendOptions,
    runApplication: (values: Parameters<typeof runApplication>[0], client: boolean) =>
      runApplication(values, client, async (options: BackendOptions) => {
        if (process.env["TEST_BACKEND_FAIL"] === "1") throw new Error("Backend startup failed");
        if (process.env["TEST_STOP_DURING_STARTUP"]) {
          const signal = options.signal;
          if (!signal) throw new Error("Missing startup signal");
          await new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true },
            );
            setImmediate(() => {
              process.emit("SIGTERM");
            });
          });
          console.log("startup:cleaned");
          if (process.env["TEST_STOP_DURING_STARTUP"] === "failure")
            throw new Error("Startup cleanup failed");
          throw signal.reason;
        }
        console.log(`sdk:${JSON.stringify(options.pi)}`);
        console.log(`port:${options.port}`);
        console.log(`renderer:${options.developmentOrigin ?? "built"}`);
        console.log(`accounts:${options.pi.agentDir}`);
        if (process.env["TEST_STOP_ON_READY"] === "1") {
          process.emit("SIGTERM");
          process.emit("SIGTERM");
        } else if (process.env["TEST_LAUNCHER_TARGET"] === "server") {
          setImmediate(() => {
            process.emit("SIGINT");
          });
        }
        return {
          connectionUrl: `http://127.0.0.1:4317/#token=${"a".repeat(64)}`,
          origin: "http://127.0.0.1:4317",
          close: async (): Promise<void> => {
            console.log("closed:backend");
          },
        };
      }),
  },
});

await import(
  process.env["TEST_LAUNCHER_TARGET"] === "server"
    ? "../../../scripts/server.ts"
    : "../../../scripts/launch.ts"
);
