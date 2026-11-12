import { PinIcon, StarIcon } from "lucide-react";
import { useState, type ReactElement } from "react";

import type {
  SessionId,
  SessionMetadata,
  SessionSummary,
  StoredSession,
} from "../contracts/index.ts";
import { Button } from "./components/ui/button.tsx";

export function SessionsLibrary({
  catalog,
  sessions,
  disabled,
  metadata,
  onOpen,
  onFlag,
}: {
  catalog: StoredSession[];
  sessions: SessionSummary[];
  disabled: boolean;
  metadata: SessionMetadata[];
  onOpen: (session: StoredSession) => void;
  onFlag: (id: SessionId, flag: "pinned" | "favourite", value: boolean) => void;
}): ReactElement {
  const [search, setSearch] = useState("");
  const [directory, setDirectory] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const directories = [...new Set(catalog.map((session) => session.cwd))].toSorted();
  const query = search.trim().toLocaleLowerCase();
  const filtered = catalog
    .filter(
      (session) =>
        (!directory || session.cwd === directory) &&
        (!favouritesOnly || metadata.some((item) => item.id === session.id && item.favourite)) &&
        `${session.name} ${session.id} ${session.cwd}`.toLocaleLowerCase().includes(query),
    )
    .toSorted((a, b) => b.modified.localeCompare(a.modified));
  return (
    <section aria-label="Sessions" className="min-h-0 flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-xl font-semibold">Sessions</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          aria-label="Search sessions"
          type="search"
          placeholder="Search sessions…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          aria-label="Filter by directory"
          value={directory}
          onChange={(event) => {
            setDirectory(event.target.value);
          }}
          className="h-9 max-w-full rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">All directories</option>
          {directories.map((cwd) => (
            <option key={cwd} value={cwd}>
              {cwd}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={favouritesOnly}
            onChange={(event) => {
              setFavouritesOnly(event.target.checked);
            }}
          />
          Favourites only
        </label>
      </div>
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {catalog.length === 0 ? "No sessions found." : "No matching sessions."}
        </p>
      )}
      <ul className="space-y-1">
        {filtered.map((session) => {
          const live = sessions.find(
            (item) => item.sessionFile === session.path || item.sessionId === session.id,
          );
          const marks = metadata.find((item) => item.id === session.id);
          return (
            <li key={session.path} className="flex items-center gap-1">
              <Button
                variant="ghost"
                disabled={disabled}
                className="h-auto w-full justify-start whitespace-normal text-left"
                onClick={() => {
                  onOpen(session);
                }}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{session.name || session.id}</span>
                  <span className="block text-xs text-muted-foreground">
                    {session.cwd} · {new Date(session.modified).toLocaleString()}
                    {live ? ` · ${live.connection} · ${live.execution}` : ""}
                  </span>
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`${marks?.pinned ? "Unpin" : "Pin"} ${session.name || session.id}`}
                aria-pressed={marks?.pinned ?? false}
                onClick={() => {
                  onFlag(session.id, "pinned", !marks?.pinned);
                }}
              >
                <PinIcon aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`${marks?.favourite ? "Remove favourite" : "Favourite"} ${session.name || session.id}`}
                aria-pressed={marks?.favourite ?? false}
                onClick={() => {
                  onFlag(session.id, "favourite", !marks?.favourite);
                }}
              >
                <StarIcon aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
