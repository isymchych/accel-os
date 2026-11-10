import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const source = path.resolve(import.meta.dirname, "..");

export async function run(command: string, args: string[], cwd: string): Promise<void> {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited (${signal ?? code ?? "unknown"})`));
    });
  });
}

export async function launchElectron(developmentUrl?: string): Promise<void> {
  const executable: unknown = createRequire(import.meta.url)("electron");
  if (typeof executable !== "string") throw new Error("Could not locate the Electron binary");
  const env = {
    ...process.env,
    ACCEL_OS: process.env["ACCEL_OS"] ?? path.resolve(source, "../.."),
    AI_UI_NODE: process.execPath,
    AI_UI_PI_ENTRY:
      process.env["AI_UI_PI_ENTRY"] ?? path.resolve(source, "../pi/runtime/rpc-entry.ts"),
    AI_UI_CWD: process.env["AI_UI_CWD"] ?? process.env["AI_CWD"] ?? process.cwd(),
  };
  Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
  if (developmentUrl) Object.assign(env, { AI_UI_DEV_URL: developmentUrl });
  const child = spawn(executable, [source], { cwd: source, env, stdio: "inherit" });
  const terminate = (): void => {
    child.kill("SIGTERM");
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Electron exited (${signal ?? code ?? "unknown"})`));
      });
    });
  } finally {
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
  }
}
