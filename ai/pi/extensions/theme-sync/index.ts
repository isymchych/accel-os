/**
 * Syncs Pi's live TUI theme with darkman.
 *
 * darkman is the desktop-wide light/dark authority in these dotfiles. Its
 * `watch` command prints the current mode immediately, then prints every
 * subsequent mode change, so this extension can update already-running Pi
 * sessions without polling or editing `settings.json`.
 */

import { spawn, type ChildProcess } from "node:child_process";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ThemeMode = "dark" | "light";

type LineReader = {
  push(chunk: string): void;
  flush(): void;
};

export function parseDarkmanMode(line: string): ThemeMode | undefined {
  const value = line.trim();
  if (value === "dark" || value === "light") {
    return value;
  }
  return undefined;
}

export function createLineReader(onLine: (line: string) => void): LineReader {
  let pending = "";

  return {
    push(chunk: string): void {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        onLine(line);
      }
    },

    flush(): void {
      if (pending.length === 0) {
        return;
      }
      onLine(pending);
      pending = "";
    },
  };
}

function applyTheme(ctx: ExtensionContext, mode: ThemeMode): boolean {
  const result = ctx.ui.setTheme(mode);
  if (!result.success) {
    ctx.ui.notify(`darkman ${mode} theme failed: ${result.error}`, "warning");
    return false;
  }
  return true;
}

function stopWatcher(watcher: ChildProcess | undefined): void {
  if (watcher === undefined || watcher.killed) {
    return;
  }
  watcher.kill();
}

export default function themeSyncExtension(pi: ExtensionAPI): void {
  let watcher: ChildProcess | undefined;
  let currentMode: ThemeMode | undefined;

  pi.on("session_start", (_event, ctx) => {
    stopWatcher(watcher);
    watcher = undefined;
    currentMode = undefined;

    if (ctx.mode !== "tui") {
      return;
    }

    const lineReader = createLineReader((line) => {
      const mode = parseDarkmanMode(line);
      if (mode === undefined || mode === currentMode) {
        return;
      }
      if (applyTheme(ctx, mode)) {
        currentMode = mode;
      }
    });

    const nextWatcher = spawn("darkman", ["watch"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    watcher = nextWatcher;

    nextWatcher.stdout.setEncoding("utf8");
    nextWatcher.stdout.on("data", (chunk: string) => {
      lineReader.push(chunk);
    });
    nextWatcher.stdout.on("end", () => {
      lineReader.flush();
    });
    nextWatcher.stderr.resume();

    nextWatcher.on("error", (error) => {
      if (watcher !== nextWatcher) {
        return;
      }
      watcher = undefined;
      ctx.ui.notify(`darkman watch failed: ${error.message}`, "warning");
    });

    nextWatcher.on("exit", (code, signal) => {
      if (watcher !== nextWatcher) {
        return;
      }
      watcher = undefined;
      if (code !== 0 && signal === null) {
        ctx.ui.notify(`darkman watch exited with code ${code}`, "warning");
      }
    });
  });

  pi.on("session_shutdown", () => {
    stopWatcher(watcher);
    watcher = undefined;
    currentMode = undefined;
  });
}
