import { useCallback, useEffect, useReducer, useState } from "react";

import type {
  SessionKey,
  SessionMetadata,
  SessionSnapshot,
  WorkspaceObservation,
  WorkspaceState,
} from "../desktop-api.ts";
import { useApi } from "./api.ts";

type ObservedSessions = Partial<Record<SessionKey, SessionSnapshot>>;

/** HTTP command results and SSE updates share the same snapshot revision. */
export function mergeObservation(
  current: ObservedSessions,
  observation: WorkspaceObservation,
): ObservedSessions {
  if (observation.type === "metadata") return current;
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

/** SSE supplies the initial workspace and all subsequent observations. */
export function useWorkspaceObservation(
  onWorkspace: (workspace: WorkspaceState) => void,
  onSnapshot: (snapshot: SessionSnapshot) => void,
): {
  sessions: ObservedSessions;
  receive: (snapshot: SessionSnapshot) => void;
  metadata: SessionMetadata[];
  transportConnected: boolean;
} {
  const workspace = useApi();
  const [sessions, dispatch] = useReducer(mergeObservation, {});
  const [metadata, setMetadata] = useState<SessionMetadata[]>([]);
  const [transportConnected, setTransportConnected] = useState(false);
  const receive = useCallback((snapshot: SessionSnapshot): void => {
    dispatch({ type: "snapshot", snapshot });
  }, []);

  useEffect(
    () =>
      workspace.subscribe((observation) => {
        dispatch(observation);
        if (observation.type === "workspace") {
          setMetadata(observation.workspace.metadata);
          onWorkspace(observation.workspace);
        } else if (observation.type === "metadata") {
          setMetadata(observation.metadata);
        } else {
          onSnapshot(observation.snapshot);
        }
      }, setTransportConnected),
    [workspace, onWorkspace, onSnapshot],
  );

  return { sessions, receive, metadata, transportConnected };
}
