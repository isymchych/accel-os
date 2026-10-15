/**
 * Holds a Linux sleep inhibitor with a helper bound to a Pi-owned stdin pipe.
 * Closing the pipe (including parent death) lets cat exit and releases the lock.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type SuspendInhibitor = {
  acquire: (reportError: (message: string) => void) => Promise<void>;
  release: () => void;
};

type InhibitorOptions = {
  platform?: NodeJS.Platform;
  spawnProcess?: () => ChildProcessWithoutNullStreams;
};

type Lease = {
  ready: Promise<void>;
  stop: () => void;
};

const START_TIMEOUT_MS = 5_000;

function spawnInhibitor(): ChildProcessWithoutNullStreams {
  return spawn(
    "systemd-inhibit",
    [
      "--no-ask-password",
      "--what=sleep",
      "--who=pi-agent-activity",
      "--why=Pi is working",
      "--mode=block",
      "cat",
    ],
    { stdio: "pipe" },
  );
}

export function createSuspendInhibitor({
  platform = process.platform,
  spawnProcess = spawnInhibitor,
}: InhibitorOptions = {}): SuspendInhibitor {
  let current: Lease | undefined;

  return {
    async acquire(reportError): Promise<void> {
      if (platform !== "linux") {
        return;
      }
      if (current !== undefined) {
        return current.ready;
      }

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnProcess();
      } catch (error) {
        reportError(String(error));
        return;
      }

      let resolveReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      let stderr = "";
      const lease: Lease = {
        ready,
        stop(): void {
          clearTimeout(timeout);
          resolveReady();
          child.stdin.end();
          // Also cancel startup if logind has not launched cat yet.
          child.kill();
        },
      };
      current = lease;

      function fail(message: string): void {
        if (current !== lease) {
          return;
        }
        current = undefined;
        lease.stop();
        reportError(message);
      }

      const timeout = setTimeout(() => {
        fail("systemd-inhibit did not become ready within 5 seconds");
      }, START_TIMEOUT_MS);
      timeout.unref();

      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4_096);
      });
      child.on("error", (error) => fail(error.message));
      child.stdin.on("error", (error) => fail(error.message));
      child.on("close", (code, signal) => {
        fail(stderr.trim() || `systemd-inhibit exited (${signal ?? code})`);
      });
      child.stdout.once("data", () => {
        clearTimeout(timeout);
        resolveReady();
      });
      // cat starts only after systemd-inhibit acquires the lock. Its echo is
      // readiness confirmation; successful spawn alone does not prove inhibition.
      child.stdin.write("ready\n");
      return ready;
    },

    release(): void {
      const lease = current;
      current = undefined;
      lease?.stop();
    },
  };
}
