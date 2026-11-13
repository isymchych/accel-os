import { useAtom } from "@effect/atom-react";
import { PinIcon, StarIcon } from "lucide-react";
import { useState, type ReactElement } from "react";

import type { SessionId, SessionMetadata, StoredSession } from "../../contracts/index.ts";
import { useAppModel } from "../app/app-provider.tsx";
import { Button } from "../components/ui/button.tsx";
import { requestFeedback } from "../transport/errors.ts";
import type { SessionOverview } from "./workspace-state.ts";

function FlagButton({
  id,
  flag,
  marked,
  name,
  disabled,
}: {
  id: SessionId;
  flag: "pinned" | "favourite";
  marked: boolean;
  name: string;
  disabled: boolean;
}): ReactElement {
  const { requests } = useAppModel();
  const [result, change] = useAtom(requests.metadata(id, flag));
  const error = requestFeedback(result, true);
  const label =
    flag === "pinned" ? (marked ? "Unpin" : "Pin") : marked ? "Remove favourite" : "Favourite";
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        disabled={disabled || result.waiting}
        aria-label={`${label} ${name}`}
        aria-pressed={marked}
        onClick={() => {
          change(!marked);
        }}
      >
        {flag === "pinned" ? <PinIcon aria-hidden="true" /> : <StarIcon aria-hidden="true" />}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

export function SessionsLibrary({
  catalog,
  sessions,
  disabled,
  metadata,
  onOpen,
}: {
  catalog: readonly StoredSession[];
  sessions: readonly SessionOverview[];
  disabled: boolean;
  metadata: readonly SessionMetadata[];
  onOpen: (session: StoredSession) => void;
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
              <FlagButton
                id={session.id}
                flag="pinned"
                marked={marks?.pinned ?? false}
                name={session.name || session.id}
                disabled={disabled}
              />
              <FlagButton
                id={session.id}
                flag="favourite"
                marked={marks?.favourite ?? false}
                name={session.name || session.id}
                disabled={disabled}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
