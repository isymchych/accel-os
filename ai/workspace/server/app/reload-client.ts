import { randomUUID } from "node:crypto";

import { Value } from "typebox/value";

import {
  SupervisorResponseSchema,
  type SupervisorRequest,
  type SupervisorResponse,
} from "../../contracts/reload-ipc.ts";
import type { ReloadControl, ReloadResult, ReloadStatus } from "../../contracts/reload.ts";

export class ReloadClient implements ReloadControl {
  private readonly pending = new Map<
    string,
    { resolve: (value: SupervisorResponse) => void; reject: (error: Error) => void }
  >();

  public constructor() {
    process.on("message", (message: unknown) => {
      if (Value.Check(SupervisorResponseSchema, message))
        this.pending.get(message.id)?.resolve(message);
    });
    process.once("disconnect", () => {
      for (const entry of this.pending.values())
        entry.reject(new Error("Application supervisor disconnected."));
    });
  }

  public async status(): Promise<ReloadStatus> {
    const response = await this.request({ kind: "status", id: randomUUID() });
    if (response.kind !== "status-result")
      throw new Error("Unexpected application supervisor response.");
    return response.status;
  }

  public async reload(requestId: string): Promise<ReloadResult> {
    const response = await this.request({ kind: "reload", id: randomUUID(), requestId });
    if (response.kind !== "reload-result")
      throw new Error("Unexpected application supervisor response.");
    return response.result;
  }

  private async request(message: SupervisorRequest): Promise<SupervisorResponse> {
    const { id } = message;
    const result = Promise.withResolvers<SupervisorResponse>();
    this.pending.set(id, result);
    const timeout = setTimeout(
      () => result.reject(new Error("Application supervisor timed out.")),
      10_000,
    );
    try {
      if (process.send === undefined) throw new Error("Application supervisor is unavailable.");
      process.send(message, (error) => {
        if (error !== null) result.reject(error);
      });
      return await result.promise;
    } finally {
      clearTimeout(timeout);
      this.pending.delete(id);
    }
  }
}
