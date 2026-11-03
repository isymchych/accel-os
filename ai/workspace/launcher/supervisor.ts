import { randomUUID } from "node:crypto";

import { Value } from "typebox/value";

import { SupervisorRequestSchema, type SupervisorResponse } from "../contracts/reload-ipc.ts";
import type { ReloadResult, ReloadStatus } from "../contracts/reload.ts";
import { ApplicationProcess } from "./application-process.ts";
import {
  discardCandidate,
  prepareArtifact,
  publishArtifact,
  readArtifact,
  type Artifact,
} from "./artifacts.ts";
import { BuildRunner } from "./build-runner.ts";

type WorkspaceSupervisorOptions = {
  source: string;
  state: string;
  port: number;
};

export class WorkspaceSupervisor {
  public port: number;
  private readonly options: WorkspaceSupervisorOptions;
  private readonly builder: BuildRunner;
  private savedArtifact: Artifact;
  private application: ApplicationProcess | undefined;
  private closed = false;
  private operation: Promise<void> | undefined;
  private readonly seen = new Set<string>();
  private readonly abort = new AbortController();
  private readonly currentStatus: ReloadStatus;

  private constructor(options: WorkspaceSupervisorOptions, active: Artifact) {
    this.options = options;
    this.builder = new BuildRunner(options.source, options.state);
    this.savedArtifact = active;
    this.port = options.port;
    this.currentStatus = {
      ownerId: randomUUID(),
      savedVersion: active.id,
      servingVersion: null,
      operationId: null,
      phase: "idle",
      message: "Application is up to date.",
    };
  }

  public static async start(options: WorkspaceSupervisorOptions): Promise<WorkspaceSupervisor> {
    const active = await readArtifact(options.state);
    await discardCandidate(options.state);
    const supervisor = new WorkspaceSupervisor(options, active);
    supervisor.application = await supervisor.prepareApplication(active);
    try {
      supervisor.port = await supervisor.application.listen();
      supervisor.currentStatus.servingVersion = active.id;
    } catch (error) {
      await supervisor.application.close();
      throw error;
    }
    return supervisor;
  }

  public status(): ReloadStatus {
    return { ...this.currentStatus };
  }

  public reload(requestId: string): ReloadResult {
    if (this.seen.has(requestId)) return { accepted: true, status: this.status() };
    if (this.closed || this.operation !== undefined)
      return { accepted: false, status: this.status() };
    this.seen.add(requestId);
    this.currentStatus.operationId = requestId;
    this.currentStatus.phase = "checking";
    this.currentStatus.message = "Checking edited source. The running version remains active.";
    this.operation = this.performReload().finally(() => {
      this.operation = undefined;
    });
    return { accepted: true, status: this.status() };
  }

  public async waitForReload(): Promise<void> {
    await this.operation;
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    await this.operation;
    await this.application?.close();
  }

  private async prepareApplication(candidate: Artifact): Promise<ApplicationProcess> {
    const application = await ApplicationProcess.prepare(candidate, this.port);
    application.child.on("message", (message: unknown) => {
      if (!Value.Check(SupervisorRequestSchema, message)) return;
      const response: SupervisorResponse =
        message.kind === "reload"
          ? { kind: "reload-result", id: message.id, result: this.reload(message.requestId) }
          : { kind: "status-result", id: message.id, status: this.status() };
      application.child.send(response, () => {});
    });
    application.child.once("exit", () => {
      if (this.application !== application) return;
      this.currentStatus.servingVersion = null;
      if (!this.closed && this.currentStatus.phase !== "activating") {
        this.currentStatus.phase = "failed";
        this.currentStatus.message =
          "Application child exited. Restart the application; the launcher remains alive.";
      }
    });
    return application;
  }

  private async performReload(): Promise<void> {
    let replacement: ApplicationProcess | undefined;
    try {
      const candidate = await this.checkedBuild();
      replacement = await this.prepareApplication(candidate);
      this.abort.signal.throwIfAborted();
      this.currentStatus.phase = "activating";
      this.currentStatus.message = "Replacing the API. Clients will reconnect.";
      await this.application?.close();
      this.application = replacement;
      replacement = undefined;
      try {
        await this.application.listen();
        this.currentStatus.servingVersion = candidate.id;
        await publishArtifact(this.options.state, candidate);
      } catch (error) {
        await this.application.close();
        this.application = await this.prepareApplication(this.savedArtifact);
        await this.application.listen();
        this.currentStatus.servingVersion = this.savedArtifact.id;
        throw error;
      }
      this.savedArtifact = candidate;
      this.currentStatus.savedVersion = candidate.id;
      this.currentStatus.phase = "succeeded";
      this.currentStatus.message = "Check & Reload completed.";
    } catch (error) {
      this.reportFailure(error);
    } finally {
      try {
        await replacement?.close();
        await discardCandidate(this.options.state);
      } catch (error) {
        this.reportFailure(error);
      }
    }
  }

  private reportFailure(error: unknown): void {
    console.error(`Check & Reload failed during ${this.currentStatus.phase}.`, error);
    this.currentStatus.phase = "failed";
    this.currentStatus.message = `Check & Reload failed. Saved version: ${this.currentStatus.savedVersion}. API: ${this.currentStatus.servingVersion ?? "unavailable"}. See local command output; fix the problem and retry.`;
  }

  private async checkedBuild(): Promise<Artifact> {
    const signal = this.abort.signal;
    signal.throwIfAborted();
    const candidate = await prepareArtifact(this.options.state);
    await this.builder.check(signal);
    signal.throwIfAborted();
    this.currentStatus.phase = "building";
    this.currentStatus.message = "Building the updated application.";
    await this.builder.build(candidate, signal);
    signal.throwIfAborted();
    return candidate;
  }
}
