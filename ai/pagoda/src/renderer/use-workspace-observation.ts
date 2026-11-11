import { useCallback, useEffect, useReducer, useState } from "react";

import type {
  SessionKey,
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
export function useWorkspaceObservation(onWorkspace: (workspace: WorkspaceState) => void): {
  sessions: ObservedSessions;
  receive: (snapshot: SessionSnapshot) => void;
  transportConnected: boolean;
} {
  const workspace = useApi();
  const [sessions, dispatch] = useReducer(mergeObservation, {});
  const [transportConnected, setTransportConnected] = useState(false);
  const receive = useCallback((snapshot: SessionSnapshot): void => {
    dispatch({ type: "snapshot", snapshot });
  }, []);

  useEffect(
    () =>
      workspace.subscribe((observation) => {
        dispatch(observation);
        if (observation.type === "workspace") onWorkspace(observation.workspace);
      }, setTransportConnected),
    [workspace, onWorkspace],
  );

  return { sessions, receive, transportConnected };
}
