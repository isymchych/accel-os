import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type {
  SessionKey,
  SessionMetadata,
  SessionSnapshot,
  SessionSummary,
  WorkspaceEvents,
  WorkspaceObservation,
  WorkspaceState,
} from "../../contracts/index.ts";
import type { SessionState } from "../session/session-state.ts";
import type { WorkspaceRequests } from "./requests.ts";

type ObservedSessions = Partial<Record<SessionKey, SessionSnapshot>>;
export type SessionOverview = Omit<SessionSummary, "revision">;

interface ObservedWorkspace {
  sessions: ObservedSessions;
  metadata: readonly SessionMetadata[];
  selectedAccount: string | null;
  transportConnected: boolean;
  initial: WorkspaceState | null;
}

type WorkspaceEvent = WorkspaceObservation | { type: "connection"; connected: boolean };

export interface WorkspaceAtoms {
  state: Atom.Atom<ObservedWorkspace>;
  receive(registry: AtomRegistry.AtomRegistry, event: WorkspaceEvent): void;
  subscription: Atom.Atom<undefined>;
  session(key: SessionKey): Atom.Atom<SessionSnapshot | undefined>;
  summaries: Atom.Atom<readonly SessionOverview[]>;
  connected: Atom.Atom<boolean>;
  initial: Atom.Atom<WorkspaceState | null>;
  metadata: Atom.Atom<readonly SessionMetadata[]>;
  selectedAccount: Atom.Atom<string | null>;
}

/** HTTP command results and SSE observations use the same revision-ordered merge. */
export function mergeObservation(
  current: ObservedSessions,
  observation: WorkspaceObservation,
): ObservedSessions {
  if (observation.type === "metadata" || observation.type === "account") return current;
  const snapshots =
    observation.type === "workspace" ? observation.workspace.sessions : [observation.snapshot];
  let next = current;
  for (const snapshot of snapshots) {
    if (snapshot.revision >= (next[snapshot.key]?.revision ?? -1)) {
      next = { ...next, [snapshot.key]: snapshot };
    }
  }
  return next;
}

function sameOverview(a: SessionOverview, b: SessionOverview): boolean {
  return (
    a.key === b.key &&
    a.connection === b.connection &&
    a.execution === b.execution &&
    a.cwd === b.cwd &&
    a.sessionId === b.sessionId &&
    a.sessionFile === b.sessionFile &&
    a.name === b.name
  );
}

/** Owns observation lifetime, authoritative state, and observation-driven query invalidation. */
export function createWorkspaceAtoms(
  events: WorkspaceEvents,
  requests: Pick<WorkspaceRequests, "catalog" | "accounts">,
  queries: Pick<SessionState, "history" | "controls">,
): WorkspaceAtoms {
  const state = Atom.make<ObservedWorkspace>({
    sessions: {},
    metadata: [],
    selectedAccount: null,
    transportConnected: false,
    initial: null,
  }).pipe(Atom.keepAlive);

  function refreshSession(
    registry: AtomRegistry.AtomRegistry,
    previous: SessionSnapshot | undefined,
    snapshot: SessionSnapshot,
    reconnect: boolean,
  ): boolean {
    const connected = snapshot.connection === "connected";
    if (!previous) return connected;
    const reconnected = connected && (reconnect || previous.connection !== snapshot.connection);
    if (reconnected || snapshot.controlsRevision !== previous.controlsRevision)
      registry.refresh(queries.controls(snapshot.key));
    if (reconnected || snapshot.historyRevision !== previous.historyRevision)
      registry.refresh(queries.history(snapshot.key));
    const completed =
      (previous.execution === "running" || previous.execution === "stopping") &&
      snapshot.execution === "idle";
    return reconnected || completed;
  }

  function receive(registry: AtomRegistry.AtomRegistry, event: WorkspaceEvent): void {
    const current = registry.get(state);
    if (event.type === "connection") {
      registry.set(state, { ...current, transportConnected: event.connected });
      return;
    }
    const sessions = mergeObservation(current.sessions, event);
    registry.set(state, {
      ...current,
      sessions,
      ...(event.type === "workspace"
        ? {
            initial: event.workspace,
            metadata: event.workspace.metadata,
            selectedAccount: event.workspace.selectedAccount,
          }
        : {}),
      ...(event.type === "metadata" ? { metadata: event.metadata } : {}),
      ...(event.type === "account" ? { selectedAccount: event.profile } : {}),
    });

    const reconnect = event.type === "workspace";
    let refreshCatalog = reconnect;
    const snapshots =
      event.type === "workspace"
        ? event.workspace.sessions
        : event.type === "snapshot"
          ? [event.snapshot]
          : [];
    for (const snapshot of snapshots) {
      if (sessions[snapshot.key] !== snapshot) continue;
      if (refreshSession(registry, current.sessions[snapshot.key], snapshot, reconnect))
        refreshCatalog = true;
    }
    if (event.type === "metadata") {
      const catalog = AsyncResult.getOrElse(registry.get(requests.catalog), () => []);
      refreshCatalog = event.metadata.some(
        (mark) => mark.pinned && !catalog.some((session) => session.id === mark.id),
      );
    }
    if (refreshCatalog) registry.refresh(requests.catalog);
    if (reconnect || (event.type === "account" && event.profile !== current.selectedAccount))
      registry.refresh(requests.accounts);
  }

  const connected = Atom.map(state, (value) => value.transportConnected);
  const session = Atom.family((key: SessionKey) => {
    const observed = Atom.map(state, (value) => value.sessions[key]);
    return Atom.make((get) => {
      const snapshot = get(observed);
      return snapshot && !get(connected)
        ? { ...snapshot, connection: "disconnected" as const, execution: "unknown" as const }
        : snapshot;
    });
  });
  const summaries = Atom.map(state, (value): SessionOverview[] =>
    Object.values(value.sessions).flatMap((snapshot) =>
      snapshot
        ? [
            {
              key: snapshot.key,
              connection: snapshot.connection,
              execution: snapshot.execution,
              cwd: snapshot.cwd,
              sessionId: snapshot.sessionId,
              sessionFile: snapshot.sessionFile,
              name: snapshot.name,
            },
          ]
        : [],
    ),
  ).pipe(
    Atom.withEquality(
      (a: SessionOverview[], b: SessionOverview[]) =>
        a.length === b.length &&
        a.every((item, index) => b[index] !== undefined && sameOverview(item, b[index])),
    ),
  );
  const subscription = Atom.make((get) => {
    get.addFinalizer(
      events.subscribe(
        (event) => {
          receive(get.registry, event);
        },
        (value) => {
          receive(get.registry, { type: "connection", connected: value });
        },
      ),
    );
    return undefined;
  });
  return {
    state,
    receive,
    subscription,
    session,
    summaries,
    connected,
    initial: Atom.map(state, (value) => value.initial),
    metadata: Atom.map(state, (value) => value.metadata),
    selectedAccount: Atom.map(state, (value) => value.selectedAccount),
  };
}
