/**
 * Collects Pi activity for Noctalia and owns an independent logind idle inhibitor.
 * The inhibitor's cat child lives only while its stdin pipe is open, including
 * when this helper dies. No manual caffeine state is read or changed.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type AgentCounts = { working: number; waiting: number };
export type ActivityStatus = AgentCounts & { inhibited: boolean; error?: string };

function vanished(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

export async function collectActivity(
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- An empty runtime directory is unset, not a relative path.
  runtimeRoot = process.env["XDG_RUNTIME_DIR"] ||
    path.join(tmpdir(), `accel-os-${process.getuid?.() ?? "unknown"}`),
  procRoot = "/proc",
): Promise<AgentCounts> {
  const directory = path.join(runtimeRoot, "accel-os/pi-agents");
  const counts = { working: 0, waiting: 0 };
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (vanished(error)) return counts;
    throw error;
  }
  for (const name of names) {
    const pid = /^(\d+)\.state$/u.exec(name)?.[1];
    if (pid === undefined) continue;
    try {
      const cmdline = await readFile(path.join(procRoot, pid, "cmdline"), "utf8");
      if (!cmdline.split("\0").some((arg) => arg.endsWith("/ai/pi/ai.ts"))) continue;
      const content = await readFile(path.join(directory, name), "utf8");
      const state = /^([^\n]*)\n/u.exec(content)?.[1];
      if (state === "working") counts.working += 1;
      else if (state === "idle") counts.waiting += 1;
    } catch (error) {
      // Agents may exit between listing, checking their identity, and reading.
      // Other errors must not silently turn unknown activity into zero.
      if (!vanished(error)) throw error;
    }
  }
  return counts;
}

function spawnInhibitor(): ChildProcessWithoutNullStreams {
  return spawn(
    "systemd-inhibit",
    [
      "--no-ask-password",
      "--what=idle",
      "--mode=block",
      "--who=noctalia-pi-activity",
      "--why=Pi agents are working",
      "cat",
    ],
    { stdio: "pipe" },
  );
}

export class ActivityMonitor {
  private counts: AgentCounts = { working: 0, waiting: 0 };
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready = false;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private collectionIssue: string | undefined;
  private inhibitorIssue: string | undefined;
  private pending = false;
  private closed = false;
  private readonly publish: (status: ActivityStatus) => void;
  private readonly collect: () => Promise<AgentCounts>;
  private readonly spawnInhibitor: () => ChildProcessWithoutNullStreams;

  public constructor(
    publish: (status: ActivityStatus) => void,
    {
      collect = collectActivity,
      startInhibitor = spawnInhibitor,
    }: {
      collect?: () => Promise<AgentCounts>;
      startInhibitor?: () => ChildProcessWithoutNullStreams;
    } = {},
  ) {
    this.publish = publish;
    this.collect = collect;
    this.spawnInhibitor = startInhibitor;
  }

  private report(): void {
    const error = this.collectionIssue ?? this.inhibitorIssue;
    this.publish({
      ...this.counts,
      inhibited: this.ready,
      ...(error === undefined ? {} : { error }),
    });
  }

  private release(): void {
    const child = this.child;
    this.child = undefined;
    clearTimeout(this.startup);
    // Normal release needs no process identity protocol or signal. During
    // acquisition, also cancel systemd-inhibit before it has launched cat.
    child?.stdin.end();
    if (!this.ready) child?.kill();
    this.ready = false;
  }

  private acquire(): void {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnInhibitor();
    } catch (error) {
      this.inhibitorIssue = `Pi idle inhibition failed: ${String(error)}`;
      return;
    }
    this.child = child;
    let diagnostic = "";
    const fail = (message: string): void => {
      if (this.child !== child) return;
      this.release();
      this.inhibitorIssue = `Pi idle inhibition failed: ${message}`;
      this.report();
    };
    this.startup = setTimeout(() => {
      fail("not ready within 5 seconds");
    }, 5000);
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
    });
    child.on("error", (error) => {
      fail(error.message);
    });
    child.stdin.on("error", (error) => {
      fail(error.message);
    });
    child.on("close", (code, signal) => {
      fail(diagnostic.trim() || `systemd-inhibit exited (${signal ?? code})`);
    });
    child.stdout.once("data", () => {
      if (this.child !== child) return;
      // cat can echo only after systemd-inhibit has acquired the lock.
      clearTimeout(this.startup);
      this.ready = true;
      this.inhibitorIssue = undefined;
      this.report();
    });
    child.stdin.write("ready\n");
  }

  public async refresh(): Promise<void> {
    if (this.closed || this.pending) return;
    this.pending = true;
    let counts: AgentCounts | undefined;
    try {
      counts = await this.collect();
      this.collectionIssue = undefined;
    } catch (error) {
      // Unknown is not idle: retain the last counts and inhibition decision.
      this.collectionIssue = `Pi activity unavailable: ${String(error)}`;
    } finally {
      this.pending = false;
    }
    // stop() may run while collection is pending.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (this.closed) return;
    if (counts !== undefined) this.counts = counts;
    if (this.counts.working > 0) {
      if (this.child === undefined) this.acquire();
    } else {
      this.release();
      this.inhibitorIssue = undefined;
    }
    this.report();
  }

  public stop(): void {
    this.closed = true;
    this.release();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const monitor = new ActivityMonitor((status) => {
    process.stdout.write(`${JSON.stringify(status)}\n`);
  });
  const timer = setInterval(() => void monitor.refresh(), 3000);
  const stop = (): void => {
    clearInterval(timer);
    monitor.stop();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  void monitor.refresh();
}
