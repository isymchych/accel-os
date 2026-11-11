import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const backendOptions = {
  cwd: { type: "string" },
  "profile-dir": { type: "string" },
  "code-navigation": { type: "string" },
  port: { type: "string", default: "4317" },
} as const;

interface LaunchOptions {
  cwd?: string;
  "profile-dir"?: string;
  "code-navigation"?: string;
  port: string;
  dev?: boolean;
  browser?: boolean;
}

/** Shared foreground lifetime for server, browser, and Electron launches. */
export async function runApplication(values: LaunchOptions, client: boolean): Promise<void> {
  const source = path.resolve(import.meta.dirname, "..");
  const args = [
    path.join(source, "dist/main/backend/entry.js"),
    "--cwd",
    values.cwd ?? process.env["AI_CWD"] ?? process.cwd(),
    "--port",
    values.port,
  ];
  for (const name of ["profile-dir", "code-navigation"] as const) {
    const value = values[name];
    if (value !== undefined) args.push(`--${name}`, value);
  }
  if (values.dev) args.push("--dev");
  const env = {
    ...process.env,
    ACCEL_OS: process.env["ACCEL_OS"] ?? path.resolve(source, "../.."),
    PAGODA_BACKEND_PORT: values.port,
  };
  const vite = values.dev
    ? await (
        await import("vite")
      ).createServer({
        configFile: path.join(source, "vite.config.ts"),
        server: { proxy: { "/api": { target: `http://127.0.0.1:${values.port}` } } },
      })
    : undefined;
  let backend: ChildProcess | undefined;
  let electron: ChildProcess | undefined;
  let backendExit: Promise<void> | undefined;
  let electronExit: Promise<void> | undefined;
  let stopping = false;
  const stop = (): void => {
    stopping = true;
    electron?.kill("SIGTERM");
    backend?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("disconnect", stop);
  try {
    await vite?.listen();
    const child = spawn(process.execPath, args, {
      cwd: source,
      env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    backend = child;
    backendExit = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (stopping || (!client && code === 0)) resolve();
        else reject(new Error(`Backend exited (${signal ?? code ?? "unknown"})`));
      });
    });
    const url = await Promise.race([
      new Promise<string>((resolve) => {
        child.once("message", (message: { url: string }) => {
          resolve(message.url);
        });
      }),
      backendExit,
    ]);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- A signal can arrive while awaiting readiness.
    if (url === undefined || stopping) return;
    if (!client || values.browser) {
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
      await backendExit;
    } else {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Electron's Node entry exports its executable path, unlike its main-process declarations.
      const executable = createRequire(import.meta.url)("electron") as string;
      const shell = spawn(executable, [source], {
        cwd: source,
        env: { ...env, PAGODA_URL: url },
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
      await Promise.race([backendExit, electronExit]);
    }
  } finally {
    stop();
    await Promise.allSettled([backendExit, electronExit]);
    await vite?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("disconnect", stop);
    if (process.connected) process.disconnect();
  }
}
