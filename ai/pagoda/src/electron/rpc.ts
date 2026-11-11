import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

import { Value } from "typebox/value";

import {
  CommandsSchema,
  ControlResultSchema,
  parseRecord,
  ResponseSchema,
  UiSchema,
  type PiRecord,
  type PiResponse,
} from "./protocol.ts";

export interface PiLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface Pending {
  command: string;
  resolve: (response: PiResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Small RPC transport for the desktop's command subset. The installed upstream
 * RpcClient does not expose extension UI responses or child-exit subscriptions.
 */
export class PiRpc {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private failure: Error | null = null;
  private closing: Promise<void> | null = null;
  private exit: Promise<void> = Promise.resolve();
  private listeners = new Set<(record: PiRecord) => void>();
  private exitListeners = new Set<(error: Error) => void>();

  public constructor(launch: PiLaunch) {
    this.launch = launch;
  }

  private readonly launch: PiLaunch;

  public subscribe(listener: (record: PiRecord) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  public start(): void {
    if (this.child) throw new Error("Pi is already started");
    const child = spawn(this.launch.executable, this.launch.args, {
      cwd: this.launch.cwd,
      env: this.launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.exit = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.fail(
          new Error(
            `Pi exited (${signal ?? code ?? "unknown"}). Reopen the saved conversation to reconnect.`,
          ),
        );
        resolve();
      });
    });
    child.once("error", () => {
      this.fail(new Error("Could not start Pi. Check the Node runtime and launch configuration."));
    });
    child.stdin.on("error", () => {
      this.fail(new Error("Pi's command connection closed."));
    });
    // Do not forward potentially sensitive diagnostics to the renderer.
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.stdout.setEncoding("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      try {
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          if (newline > 16 * 1024 * 1024) throw new Error("Pi RPC record exceeds 16 Mi characters");
          const line = buffer.slice(0, newline).replace(/\r$/u, "");
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) this.receive(parseRecord(line));
          newline = buffer.indexOf("\n");
        }
        if (buffer.length > 16 * 1024 * 1024)
          throw new Error("Pi RPC record exceeds 16 Mi characters");
      } catch {
        this.fail(
          new Error("Pi sent invalid or oversized RPC output. See the launching terminal."),
        );
        void this.close();
      }
    });
  }

  public async request(command: string, fields: Record<string, unknown> = {}): Promise<PiResponse> {
    if (this.failure) throw this.failure;
    if (!this.child || this.closing) throw new Error("Pi is not connected");
    this.nextId += 1;
    const id = `desktop-${this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Pi did not confirm ${command} within 30 seconds. Do not automatically retry input.`,
          ),
        );
      }, 30_000);
      this.pending.set(id, { command, resolve, reject, timer });
      void this.write({ ...fields, id, type: command }).catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new Error("Pi write failed"));
      });
    });
  }

  public async cancelDialog(id: string): Promise<void> {
    await this.write({ type: "extension_ui_response", id, cancelled: true });
  }

  public async control(
    operation: "list" | "navigate" | "snapshot",
    value: string,
  ): Promise<unknown> {
    // Fail before submitting a slash command if this runtime lacks the bridge.
    const commands = await this.request("get_commands");
    if (
      !Value.Check(CommandsSchema, commands.data) ||
      !commands.data.commands.some((command) => command.name === "workspace-control")
    )
      throw new Error("Pi's desktop session bridge is unavailable");
    const id = randomUUID();
    let result: unknown;
    const unsubscribe = this.subscribe((record) => {
      if (
        record.type !== "extension_ui_request" ||
        !Value.Check(UiSchema, record) ||
        record.method !== "notify" ||
        !record.message?.startsWith("workspace-control:")
      )
        return;
      const response: unknown = JSON.parse(record.message.slice("workspace-control:".length));
      if (!Value.Check(ControlResultSchema, response))
        throw new Error("Invalid desktop control result");
      if (response.id !== id) return;
      result = response;
    });
    try {
      await this.request("prompt", {
        message: `/workspace-control ${JSON.stringify({ id, operation, value })}`,
      });
      if (!Value.Check(ControlResultSchema, result))
        throw new Error("Pi did not confirm the desktop control operation");
      if (!result.success) throw new Error(result.error ?? "Pi rejected the desktop control");
      return result.data;
    } finally {
      unsubscribe();
    }
  }

  public async close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async write(record: Record<string, unknown>): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed || this.failure) throw new Error("Pi is not connected");
    if (!child.stdin.write(`${JSON.stringify(record)}\n`)) await once(child.stdin, "drain");
  }

  private receive(record: PiRecord): void {
    if (record.type === "response") {
      if (!Value.Check(ResponseSchema, record)) throw new Error("Invalid Pi response");
      const pending = record.id ? this.pending.get(record.id) : undefined;
      if (!pending || !record.id) return;
      this.pending.delete(record.id);
      clearTimeout(pending.timer);
      if (record.command !== pending.command)
        pending.reject(new Error("Pi response command mismatch"));
      else if (record.success) {
        pending.resolve(record);
      } else {
        pending.reject(new Error(record.error ?? "Pi rejected the command"));
      }
      return;
    }
    for (const listener of this.listeners) listener(record);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.exitListeners) listener(error);
  }

  private async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    if (!(await this.waitForExit(5_000))) {
      this.kill("SIGTERM");
      if (!(await this.waitForExit(1_000))) {
        this.kill("SIGKILL");
        await this.exit;
      }
    }
    this.fail(new Error("Pi connection closed"));
    this.listeners.clear();
    this.exitListeners.clear();
  }

  private kill(signal: NodeJS.Signals): void {
    const pid = this.child?.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") this.child?.kill(signal);
      else process.kill(-pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  }

  private async waitForExit(milliseconds: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exit.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
