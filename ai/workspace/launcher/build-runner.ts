import { spawn } from "node:child_process";

import type { Artifact } from "./artifacts.ts";

export class BuildRunner {
  private readonly source: string;
  private readonly state: string;

  public constructor(source: string, state: string) {
    this.source = source;
    this.state = state;
  }

  public async check(signal: AbortSignal): Promise<void> {
    await runPnpm(this.source, this.state, ["run", "check"], signal);
  }

  public async build(candidate: Artifact, signal: AbortSignal): Promise<void> {
    await runPnpm(
      this.source,
      this.state,
      ["run", "build", "--candidate", candidate.directory, candidate.id],
      signal,
    );
  }
}

// Shutdown also terminates the command's subprocesses.
async function runPnpm(
  source: string,
  state: string,
  args: string[],
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const command = spawn("pnpm", args, {
      cwd: source,
      env: { ...process.env, WORKSPACE_STATE_DIR: state },
      stdio: "inherit",
      detached: true,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kill = (killSignal: NodeJS.Signals): void => {
      if (command.pid === undefined) return;
      try {
        process.kill(-command.pid, killSignal);
      } catch {
        /* Already exited. */
      }
    };
    const stop = (): void => {
      kill("SIGTERM");
      timer = setTimeout(() => kill("SIGKILL"), 5_000);
    };
    signal.addEventListener("abort", stop, { once: true });
    command.once("error", (error) => {
      cleanup();
      reject(error);
    });
    command.once("exit", (code) => {
      cleanup();
      if (signal.aborted) kill("SIGKILL");
      if (signal.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error(`pnpm run ${args[1]} failed.`));
    });
    function cleanup(): void {
      signal.removeEventListener("abort", stop);
      clearTimeout(timer);
    }
    if (signal.aborted) stop();
  });
}
