/**
 * Owns each Pi process' activity state, Waybar reporting, and suspend inhibition.
 *
 * The extension writes one small per-process state file under XDG_RUNTIME_DIR so
 * external status bars can count agents that are actively running an agent turn,
 * compaction, or branch summary without scraping terminal UI or guessing from
 * process names. On Linux, work also holds a sleep-only inhibitor; screen
 * locking, display power management, and lid handling remain unchanged.
 */
import { mkdir, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createSuspendInhibitor, type SuspendInhibitor } from "./suspend-inhibitor.ts";

type AgentState = "idle" | "working";

const STATE_ROOT_NAME = "accel-os/pi-agents";
const IDLE_CHECK_MS = 1_000;

function getRuntimeRoot(): string {
  const runtimeDir = process.env["XDG_RUNTIME_DIR"];
  if (runtimeDir !== undefined && runtimeDir.length > 0) {
    return runtimeDir;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
  return path.join(tmpdir(), `accel-os-${uid}`);
}

function getStateDir(): string {
  return path.join(getRuntimeRoot(), STATE_ROOT_NAME);
}

function getStateFile(): string {
  return path.join(getStateDir(), `${process.pid}.state`);
}

async function writeState(state: AgentState, ctx: ExtensionContext): Promise<void> {
  const stateDir = getStateDir();
  await mkdir(stateDir, { recursive: true });

  const stateFile = getStateFile();
  const tmpFile = `${stateFile}.${process.hrtime.bigint()}.tmp`;
  const content = `${state}\n${Date.now()}\n${ctx.cwd}\n`;
  await writeFile(tmpFile, content, "utf8");
  await rename(tmpFile, stateFile);
}

async function removeState(): Promise<void> {
  await rm(getStateFile(), { force: true });
}

type AgentActivityOptions = {
  inhibitor?: SuspendInhibitor;
};

export default function agentActivityExtension(
  pi: ExtensionAPI,
  { inhibitor = createSuspendInhibitor() }: AgentActivityOptions = {},
): void {
  let state: AgentState | undefined;
  let idleCheck: ReturnType<typeof setInterval> | undefined;
  let pendingWrite = Promise.resolve();
  let closed = false;

  function warn(ctx: ExtensionContext, message: string): void {
    const text = `Pi activity: ${message}`;
    if (ctx.hasUI) {
      ctx.ui.notify(text, "warning");
    } else {
      console.error(text);
    }
  }

  function stopIdleCheck(): void {
    clearInterval(idleCheck);
    idleCheck = undefined;
  }

  async function setState(next: AgentState, ctx: ExtensionContext): Promise<void> {
    if (closed || state === next) {
      return;
    }
    state = next;

    let acquisition = Promise.resolve();
    if (next === "working") {
      acquisition = inhibitor.acquire((message) =>
        warn(ctx, `suspend inhibition failed: ${message}`),
      );
      // Pi has no terminal event for failed/cancelled branch summaries or run
      // preparation failures. Poll only during work, using Pi's canonical idle
      // state, rather than guessing whether a summary or continuation is done.
      idleCheck = setInterval(() => {
        void reconcileIdle(ctx);
      }, IDLE_CHECK_MS);
      idleCheck.unref();
    } else {
      stopIdleCheck();
      inhibitor.release();
    }

    // Serialize status writes so an earlier working write cannot overwrite idle.
    // Inhibitor management never waits for the status file to succeed.
    pendingWrite = pendingWrite
      .then(async () => writeState(next, ctx))
      .catch((error: unknown) => {
        warn(ctx, `could not publish Waybar state: ${String(error)}`);
      });
    await Promise.all([acquisition, pendingWrite]);
  }

  async function reconcileIdle(ctx: ExtensionContext): Promise<void> {
    if (!closed && ctx.isIdle()) {
      await setState("idle", ctx);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await setState("idle", ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await setState("working", ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    await setState("working", ctx);
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    await setState("working", ctx);
  });

  pi.on("session_compact", async (_event, ctx) => reconcileIdle(ctx));
  pi.on("session_compact_failed", async (_event, ctx) => reconcileIdle(ctx));

  pi.on("session_before_tree", async (event, ctx) => {
    if (event.preparation.userWantsSummary && event.preparation.entriesToSummarize.length > 0) {
      await setState("working", ctx);
    }
  });

  pi.on("session_tree", async (_event, ctx) => reconcileIdle(ctx));
  pi.on("agent_settled", async (_event, ctx) => reconcileIdle(ctx));

  pi.on("session_shutdown", async () => {
    closed = true;
    stopIdleCheck();
    inhibitor.release();
    await pendingWrite;
    await removeState();
  });
}
