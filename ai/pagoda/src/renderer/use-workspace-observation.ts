import { useCallback, useEffect, useReducer } from "react";

import type { SessionKey, SessionSnapshot, SessionSummary } from "../desktop-api.ts";

interface ObservedSession {
  summary: SessionSummary;
  snapshot?: SessionSnapshot;
}
type ObservedSessions = Partial<Record<SessionKey, ObservedSession>>;
type Observation =
  | { type: "summaries"; sessions: SessionSummary[] }
  | { type: "snapshot"; snapshot: SessionSnapshot };

/** Merge summary and snapshot revisions independently; neither discards the other. */
export function mergeObservation(
  current: ObservedSessions,
  observation: Observation,
): ObservedSessions {
  if (observation.type === "summaries") {
    let next = current;
    for (const summary of observation.sessions) {
      const existing = next[summary.key];
      if (!existing || summary.revision >= existing.summary.revision) {
        next = { ...next, [summary.key]: { ...existing, summary } };
      }
    }
    return next;
  }

  const snapshot = observation.snapshot;
  const existing = current[snapshot.key];
  if (!existing) return { ...current, [snapshot.key]: { summary: snapshot, snapshot } };
  const summary = snapshot.revision >= existing.summary.revision ? snapshot : existing.summary;
  const full =
    snapshot.revision >= (existing.snapshot?.revision ?? -1) ? snapshot : existing.snapshot;
  if (summary === existing.summary && full === existing.snapshot) return current;
  return { ...current, [snapshot.key]: { summary, ...(full ? { snapshot: full } : {}) } };
}

interface InitialWorkspace {
  initialKey: SessionKey;
  sessions: SessionSummary[];
}

/** Observe main-owned sessions independently of the selected view. */
export function useWorkspaceObservation(
  selected: SessionKey | null,
  onWorkspace: (workspace: InitialWorkspace) => void,
  onError: (error: unknown) => void,
): { sessions: ObservedSessions; receive: (snapshot: SessionSnapshot) => void } {
  const [sessions, dispatch] = useReducer(mergeObservation, {});
  const receive = useCallback((snapshot: SessionSnapshot): void => {
    dispatch({ type: "snapshot", snapshot });
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.pi.subscribe((snapshot) => {
      if (active) receive(snapshot);
    });
    void window.pi
      .workspace()
      .then((workspace) => {
        if (!active) return;
        dispatch({ type: "summaries", sessions: workspace.sessions });
        onWorkspace(workspace);
      })
      .catch((error: unknown) => {
        if (active) onError(error);
      });
    return (): void => {
      active = false;
      unsubscribe();
    };
  }, [receive, onWorkspace, onError]);

  useEffect(() => {
    if (!selected) return undefined;
    let active = true;
    void window.pi
      .snapshot(selected)
      .then((snapshot) => {
        if (active) receive(snapshot);
      })
      .catch((error: unknown) => {
        if (active) onError(error);
      });
    return (): void => {
      active = false;
    };
  }, [selected, receive, onError]);

  return { sessions, receive };
}
