import { spawn } from "node:child_process";
import path from "node:path";

import type { AccountProfile } from "./account-profiles.ts";
import type { CodeNavigationBackend } from "./launcher-args.ts";

export function uiLaunchEnvironment(
  accelOs: string,
  profile: Pick<AccountProfile, "directory">,
  codeNavigation: CodeNavigationBackend,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ACCEL_OS: accelOs,
    AI_UI_CWD: process.env["AI_CWD"] ?? process.cwd(),
    AI_UI_PROFILE_DIR: profile.directory,
    AI_UI_CODE_NAVIGATION: codeNavigation,
  };
}

export async function launchUi(
  accelOs: string,
  profile: AccountProfile,
  codeNavigation: CodeNavigationBackend,
): Promise<void> {
  const child = spawn(process.execPath, [path.join(accelOs, "ai/workspace/scripts/start.ts")], {
    env: uiLaunchEnvironment(accelOs, profile, codeNavigation),
    stdio: "inherit",
  });
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
