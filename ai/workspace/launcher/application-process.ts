import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";

import { applicationPaths, type Artifact } from "./artifacts.ts";

export class ApplicationProcess {
  public readonly child: ChildProcess;

  private constructor(candidate: Artifact, port: number) {
    const paths = applicationPaths(candidate.directory);
    this.child = fork(paths.entrypoint, [], {
      cwd: candidate.directory,
      env: {
        ...process.env,
        WORKSPACE_PORT: String(port),
        WORKSPACE_CLIENT_DIST: paths.clientDirectory,
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      execArgv: [],
    });
  }

  public static async prepare(candidate: Artifact, port: number): Promise<ApplicationProcess> {
    const application = new ApplicationProcess(candidate, port);
    try {
      await application.waitFor("prepared");
    } catch (error) {
      await application.close();
      throw error;
    }
    return application;
  }

  public async listen(): Promise<number> {
    const listening = this.waitFor("listening");
    this.child.send({ kind: "listen" });
    const message = await listening;
    if (typeof message["port"] !== "number")
      throw new Error("Application did not report its port.");
    return message["port"];
  }

  public async close(): Promise<void> {
    const { child } = this;
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
    child.kill("SIGTERM");
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitFor(kind: string): Promise<Record<string, unknown>> {
    const { child } = this;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error("Application child startup timed out.")),
        10_000,
      );
      function finish(error?: Error, result?: Record<string, unknown>): void {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("error", onError);
        if (error !== undefined) reject(error);
        else if (result !== undefined) resolve(result);
      }
      function onMessage(message: unknown): void {
        if (
          typeof message === "object" &&
          message !== null &&
          "kind" in message &&
          message.kind === kind
        )
          finish(undefined, message);
      }
      function onExit(): void {
        finish(new Error("Application child exited before it was ready."));
      }
      function onError(error: Error): void {
        finish(error);
      }
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  }
}
