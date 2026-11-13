import { Atom } from "effect/reactivity";

import type {
  SessionKey,
  SessionMetadata,
  SessionSnapshot,
  WorkspaceApi,
  WorkspaceObservation,
  WorkspaceState,
} from "../contracts/index.ts";
import type { RequestAtoms } from "./request-atoms.ts";

type ObservedSessions = Partial<Record<SessionKey, SessionSnapshot>>;

interface ObservedWorkspace {
  sessions: ObservedSessions;
  metadata: readonly SessionMetadata[];
  selectedAccount: string | null;
  transportConnected: boolean;
  initial: WorkspaceState | null;
}

type WorkspaceEvent = WorkspaceObservation | { type: "connection"; connected: boolean };

export interface WorkspaceAtoms {
  state: Atom.Writable<ObservedWorkspace>;
  receive: Atom.Writable<ObservedWorkspace, WorkspaceEvent>;
  subscription: Atom.Atom<undefined>;
}

/** HTTP command results and SSE updates share the same snapshot revision. */
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

/** One authenticated client's workspace observation and command snapshot ingestion. */
export function createWorkspaceAtoms(
  api: Pick<WorkspaceApi, "subscribe">,
  requests: Pick<RequestAtoms, "catalog">,
): WorkspaceAtoms {
  const state = Atom.make<ObservedWorkspace>({
    sessions: {},
    metadata: [],
    selectedAccount: null,
    transportConnected: false,
    initial: null,
  });
  const receive = Atom.writable(
    (get) => get(state),
    (ctx, event: WorkspaceEvent) => {
      const current = ctx.get(state);
      if (event.type === "connection") {
        ctx.set(state, { ...current, transportConnected: event.connected });
        return;
      }
      const sessions = mergeObservation(current.sessions, event);
      ctx.set(state, {
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
    },
  );
  const subscription = Atom.make((get) => {
    const unsubscribe = api.subscribe(
      (observation) => {
        if (observation.type === "snapshot") {
          const previous = get.registry.get(state).sessions[observation.snapshot.key];
          if (
            previous &&
            observation.snapshot.revision >= previous.revision &&
            (previous.execution === "running" || previous.execution === "stopping") &&
            observation.snapshot.execution === "idle"
          ) {
            get.refresh(requests.catalog);
          }
        }
        get.set(receive, observation);
      },
      (connected) => {
        get.set(receive, { type: "connection", connected });
      },
    );
    get.addFinalizer(unsubscribe);
    return undefined;
  });
  return { state, receive, subscription };
}
