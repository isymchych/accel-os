import type { SessionMetadata, SessionSnapshot, WorkspaceState } from "../contracts/index.ts";

export type WorkspaceObservation =
  | { type: "snapshot"; value: SessionSnapshot }
  | { type: "metadata"; value: SessionMetadata[] }
  | { type: "account"; value: string };

/** Backend-owned subscriptions are independent of the HTTP transport and execution owners. */
export class WorkspaceObservations {
  private readonly listeners = new Set<(event: WorkspaceObservation, revision: number) => void>();
  private readonly current: () => Effect.Effect<
    { state: WorkspaceState; revision: number },
    unknown
  >;
  private revision = 0;

  public constructor(
    current: () => Effect.Effect<{ state: WorkspaceState; revision: number }, unknown>,
  ) {
    this.current = current;
  }

  public snapshot(): Effect.Effect<{ state: WorkspaceState; revision: number }, unknown> {
    return this.current();
  }

  public subscribe(listener: (event: WorkspaceObservation, revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public publish(event: WorkspaceObservation): void {
    this.revision += 1;
    for (const listener of this.listeners) listener(event, this.revision);
  }

  public currentRevision(): number {
    return this.revision;
  }

  public close(): void {
    this.listeners.clear();
  }
}
import type { Effect } from "effect";
