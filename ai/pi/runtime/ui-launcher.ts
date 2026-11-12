import { spawn } from "node:child_process";
import path from "node:path";

export function serverLaunchArgs(): string[] {
  return ["--cwd", process.env["AI_CWD"] ?? process.cwd()];
}

export async function launchUi(accelOs: string, browser: boolean): Promise<void> {
  await runUiProcess(accelOs, "launch.ts", [
    ...serverLaunchArgs(),
    ...(browser ? ["--browser"] : []),
  ]);
}

async function runUiProcess(accelOs: string, script: string, args: string[]): Promise<void> {
  const child = spawn(
    process.execPath,
    [path.join(accelOs, "ai/pagoda/scripts", script), ...args],
    {
      env: { ...process.env, ACCEL_OS: accelOs },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    },
  );
  let terminating = false;
  const terminate = (): void => {
    if (terminating) return;
    terminating = true;
    child.kill("SIGTERM");
  };
  process.on("SIGINT", terminate);
  process.on("SIGTERM", terminate);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Pagoda exited (${signal ?? code ?? "unknown"})`));
      });
    });
  } finally {
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
  }
}
