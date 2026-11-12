import { Deferred, Effect, Queue, Stream, type Scope } from "effect";

import type { SessionMetadata, SessionSnapshot, WorkspaceState } from "../contracts/index.ts";
import type { OperationError } from "./errors.ts";

export type WorkspaceObservation =
  | { type: "snapshot"; value: SessionSnapshot }
  | { type: "metadata"; value: SessionMetadata[] }
  | { type: "account"; value: string };

interface Subscriber {
  pending: Map<string, { event: WorkspaceObservation; revision: number }>;
  wake: Queue.Queue<undefined>;
}

interface WorkspaceSubscription {
  state: WorkspaceState;
  changes: Stream.Stream<WorkspaceObservation>;
}

/** Ordered current-state subscriptions, coalesced per owner rather than queued per update. */
export class WorkspaceObservations {
  private readonly subscribers = new Set<Subscriber>();
  private readonly closed = Deferred.makeUnsafe<undefined>();
  public readonly awaitClose = Deferred.await(this.closed);
  private readonly current: () => Effect.Effect<
    { state: WorkspaceState; revision: number },
    OperationError
  >;
  private revision = 0;

  public constructor(
    current: () => Effect.Effect<{ state: WorkspaceState; revision: number }, OperationError>,
  ) {
    this.current = current;
  }

  public observe(): Effect.Effect<WorkspaceSubscription, OperationError, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      const subscriber: Subscriber = {
        pending: new Map(),
        wake: yield* Queue.sliding<undefined>(1),
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          this.subscribers.add(subscriber);
        }),
        () =>
          Effect.sync(() => {
            this.subscribers.delete(subscriber);
            subscriber.pending.clear();
            Queue.shutdownUnsafe(subscriber.wake);
          }),
      );
      // Subscribe before reading: retain only changes newer than the coherent snapshot.
      const { state, revision } = yield* this.current();
      for (const [key, item] of subscriber.pending) {
        if (item.revision <= revision) subscriber.pending.delete(key);
      }
      const changes = Stream.fromQueue(subscriber.wake).pipe(
        Stream.flatMap(() => {
          const events = [...subscriber.pending.values()].map((item) => item.event);
          subscriber.pending.clear();
          return Stream.fromIterable(events);
        }),
      );
      return { state, changes };
    });
  }

  public publish(event: WorkspaceObservation): void {
    if (Deferred.isDoneUnsafe(this.closed)) return;
    this.revision += 1;
    const key = event.type === "snapshot" ? `snapshot:${event.value.key}` : event.type;
    for (const subscriber of this.subscribers) {
      subscriber.pending.set(key, { event, revision: this.revision });
      Queue.offerUnsafe(subscriber.wake, undefined);
      // Ready consumers must see lifecycle transitions in the publishing turn.
      // With no waiting consumer, the single signal and latest-per-key state still coalesce.
      Queue.flushUnsafe(subscriber.wake);
    }
  }

  public currentRevision(): number {
    return this.revision;
  }

  public close(): void {
    Deferred.doneUnsafe(this.closed, Effect.succeed(undefined));
  }
}
