import { spawn } from "node:child_process";
import path from "node:path";

import type { AccountProfile } from "./account-profiles.ts";
import type { CodeNavigationBackend } from "./launcher-args.ts";

export function uiLaunchArgs(
  profile: Pick<AccountProfile, "directory">,
  codeNavigation: CodeNavigationBackend,
): string[] {
  return [
    "--cwd",
    process.env["AI_CWD"] ?? process.cwd(),
    "--profile-dir",
    profile.directory,
    "--code-navigation",
    codeNavigation,
  ];
}

export async function launchUi(
  accelOs: string,
  profile: AccountProfile,
  codeNavigation: CodeNavigationBackend,
): Promise<void> {
  const child = spawn(
    process.execPath,
    [path.join(accelOs, "ai/pagoda/scripts/launch.ts"), ...uiLaunchArgs(profile, codeNavigation)],
    {
      env: { ...process.env, ACCEL_OS: accelOs },
      stdio: "inherit",
    },
  );
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
        else reject(new Error(`desktop app exited (${signal ?? code ?? "unknown"})`));
      });
    });
  } finally {
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
  }
}
