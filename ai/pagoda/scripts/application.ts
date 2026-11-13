import { spawn, type ChildProcess } from "node:child_process";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { Schema as S } from "effect";

import type {
  Backend,
  BackendOptions as ServerOptions,
  startBackend as StartBackend,
} from "../src/backend/server.ts";

export const backendOptions = {
  cwd: { type: "string" },
  port: { type: "string", default: "4317" },
} as const;

const BackendOptions = S.Struct({
  cwd: S.optional(S.String),
  port: S.NumberFromString.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 65535 })),
  dev: S.optional(S.Boolean),
  browser: S.optional(S.Boolean),
});

interface LaunchOptions {
  cwd?: string;
  port: string;
  dev?: boolean;
  browser?: boolean;
}

async function startUntilStopped(
  start: typeof StartBackend,
  options: ServerOptions,
  signal: AbortSignal,
): Promise<Backend | undefined> {
  try {
    return await start(options);
  } catch (error) {
    if (signal.aborted && error === signal.reason) return undefined;
    throw error;
  }
}

/** Shared foreground lifetime for server, browser, and Electron launches. */
export async function runApplication(
  values: LaunchOptions,
  client: boolean,
  start?: typeof StartBackend,
): Promise<void> {
  const options = S.decodeUnknownSync(BackendOptions)(values);
  const source = path.resolve(import.meta.dirname, "..");
  const accelOs = process.env["ACCEL_OS"] ?? path.resolve(source, "../..");
  const cwd = await realpath(options.cwd ?? process.env["AI_CWD"] ?? process.cwd());
  const agentDir = path.join(accelOs, "ai/pi");
  const shutdown = new AbortController();
  let backend: Backend | undefined;
  let electron: ChildProcess | undefined;
  let electronExit: Promise<void> | undefined;
  let stopping = false;
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    shutdown.abort();
    electron?.kill("SIGTERM");
    resolveStopped();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("disconnect", stop);
  let vite: Awaited<ReturnType<typeof import("vite").createServer>> | undefined;
  try {
    if (options.dev) {
      vite = await (
        await import("vite")
      ).createServer({
        configFile: path.join(source, "vite.config.ts"),
        server: { proxy: { "/api": { target: `http://127.0.0.1:${options.port}` } } },
      });
      await vite.listen();
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Signals can arrive while Vite starts.
    if (stopping) return;
    const modulePath = path.join(source, "dist/main/backend/server.js");
    let startBackend = start;
    if (!startBackend) {
      // The build output corresponds to the checked source module.
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Dynamic build path cannot be resolved by TypeScript.
      const module: typeof import("../src/backend/server.ts") = await import(modulePath);
      startBackend = module.startBackend;
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Signals can arrive during the import.
    if (stopping) return;
    backend = await startUntilStopped(
      startBackend,
      {
        pi: {
          cwd,
          agentDir,
          profileDir: agentDir,
          sessionDir: path.join(agentDir, "sessions"),
          sharedDir: path.join(accelOs, "ai"),
        },
        port: options.port,
        signal: shutdown.signal,
        ...(options.dev
          ? { developmentOrigin: "http://127.0.0.1:5173" as const }
          : { clientDirectory: path.join(source, "dist/client") }),
      },
      shutdown.signal,
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Signals can arrive during startup.
    if (!backend || stopping) return;
    // The URL fragment contains a local connection credential.
    const url = backend.connectionUrl;
    if (!client || options.browser) {
      console.log(`Pagoda connection URL: ${url}`);
      console.log("Keep this terminal open. Press Ctrl+C to stop the server and active Pi work.");
      if (client) {
        const command =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "rundll32"
              : "xdg-open";
        const openArgs =
          process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
        const opener = spawn(command, openArgs, { stdio: "ignore" });
        opener.once("error", (error) => {
          console.error(error);
        });
        opener.unref();
      }
      await stopped;
    } else {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Electron's Node entry exports its executable path, unlike its main-process declarations.
      const executable = createRequire(import.meta.url)("electron") as string;
      const shell = spawn(executable, [source], {
        cwd: source,
        env: { ...process.env, PAGODA_URL: url },
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      });
      electron = shell;
      electronExit = new Promise<void>((resolve, reject) => {
        shell.once("error", reject);
        shell.once("exit", (code, signal) => {
          if (stopping || code === 0) resolve();
          else reject(new Error(`Electron exited (${signal ?? code ?? "unknown"})`));
        });
      });
      await Promise.race([stopped, electronExit]);
    }
  } finally {
    stop();
    try {
      await Promise.allSettled([electronExit]);
      await backend?.close();
    } finally {
      try {
        await vite?.close();
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
        process.removeListener("disconnect", stop);
        if (process.connected) process.disconnect();
      }
    }
  }
}
