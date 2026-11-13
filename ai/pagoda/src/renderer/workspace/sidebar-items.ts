import type { SessionKey, SessionMetadata, StoredSession } from "../../contracts/index.ts";
import type { SessionOverview } from "./workspace-state.ts";

interface SidebarItems {
  pinned: readonly StoredSession[];
  recentLive: readonly SessionOverview[];
  recentStored: readonly StoredSession[];
  sessionKeys: SessionKey[];
  nextExpiry: number | null;
}

/** Sidebar membership is presentation policy, independent of transport and React. */
export function sidebarItems({
  sessions,
  catalog,
  metadata,
  selected,
  connected,
  draftOwners,
  inactivityHours,
  now,
}: {
  sessions: readonly SessionOverview[];
  catalog: readonly StoredSession[];
  metadata: readonly SessionMetadata[];
  selected: SessionKey | null;
  connected: boolean;
  draftOwners: readonly SessionKey[];
  inactivityHours: number;
  now: number;
}): SidebarItems {
  const inactivityMs = inactivityHours * 60 * 60 * 1000;
  const pinnedIds = new Set(metadata.filter((item) => item.pinned).map((item) => item.id));
  const recentIds = new Set(
    catalog.filter((item) => Date.parse(item.modified) + inactivityMs > now).map((item) => item.id),
  );
  const recentLive = sessions.filter(
    (session) =>
      (session.sessionId === null || !pinnedIds.has(session.sessionId)) &&
      (session.key === selected ||
        !connected ||
        session.execution !== "idle" ||
        draftOwners.includes(session.key) ||
        (session.sessionId !== null && recentIds.has(session.sessionId))),
  );
  const liveIds = new Set(sessions.map((session) => session.sessionId));
  const recentStored = catalog.filter(
    (item) => !pinnedIds.has(item.id) && recentIds.has(item.id) && !liveIds.has(item.id),
  );
  const deadlines = catalog
    .map((item) => Date.parse(item.modified) + inactivityMs)
    .filter((deadline) => deadline > now);
  return {
    pinned: catalog.filter((item) => pinnedIds.has(item.id)),
    recentLive,
    recentStored,
    sessionKeys: sessions
      .filter(
        (session) =>
          (session.sessionId !== null && pinnedIds.has(session.sessionId)) ||
          recentLive.includes(session),
      )
      .map((session) => session.key),
    nextExpiry: deadlines.length > 0 ? Math.min(...deadlines) : null,
  };
}
