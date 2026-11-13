import { Dialog } from "@base-ui/react/dialog";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { GitBranchIcon, GitForkIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import type {
  HistoryEntry,
  HistoryEntryId,
  SessionHistory,
  SessionSnapshot,
} from "../../contracts/index.ts";
import { useAppModel, useRunCommand } from "../app/app-provider.tsx";
import { Button } from "../components/ui/button.tsx";
import { errorMessage, requestFeedback } from "../transport/errors.ts";

const inactiveHistory = Atom.make(AsyncResult.initial<SessionHistory>());

function historyRows(history: SessionHistory): {
  rows: { entry: HistoryEntry; depth: number; branchPoint: boolean }[];
  active: Set<HistoryEntryId>;
} {
  const children = new Map<HistoryEntryId | null, HistoryEntry[]>();
  const entries = new Map(history.entries.map((entry) => [entry.id, entry]));
  for (const entry of history.entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  const active = new Set<HistoryEntryId>();
  let ancestor = history.leafId;
  while (ancestor) {
    active.add(ancestor);
    ancestor = entries.get(ancestor)?.parentId ?? null;
  }
  const rows = [];
  const stack = (children.get(null) ?? []).toReversed().map((entry) => ({ entry, depth: 0 }));
  while (stack.length > 0) {
    const row = stack.pop();
    if (!row) break;
    const descendants = children.get(row.entry.id) ?? [];
    rows.push({ ...row, branchPoint: descendants.length > 1 });
    for (const entry of descendants.toReversed()) stack.push({ entry, depth: row.depth + 1 });
  }
  return { rows, active };
}

function HistoryEntries({
  history,
  selected,
  loading,
  pending,
  connected,
  onSelect,
  onRefresh,
}: {
  history: SessionHistory | null;
  selected: HistoryEntryId | null;
  loading: boolean;
  pending: boolean;
  connected: boolean;
  onSelect: (id: HistoryEntryId) => void;
  onRefresh: () => void;
}): ReactElement {
  const [search, setSearch] = useState("");
  const tree = useMemo(() => historyRows(history ?? { entries: [], leafId: null }), [history]);
  const query = search.trim().toLocaleLowerCase();
  const rows = tree.rows.filter(({ entry }) =>
    `${entry.label} ${entry.id}`.toLocaleLowerCase().includes(query),
  );
  return (
    <section aria-label="History entries" className="min-h-0 min-w-0 p-4">
      <div className="mb-3 flex items-center gap-2">
        <input
          type="search"
          aria-label="Search history"
          placeholder="Search entries…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh history"
          disabled={!connected || pending}
          onClick={onRefresh}
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </div>
      <div
        className="max-h-[28dvh] overflow-y-auto overscroll-contain sm:max-h-[48dvh]"
        aria-busy={loading}
      >
        {loading && <p className="px-2 py-2 text-xs text-muted-foreground">Loading history…</p>}
        {!loading && rows.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {query ? "No matching entries." : "No persisted history yet."}
          </p>
        )}
        <ol className="space-y-1">
          {rows.map(({ entry, depth, branchPoint }) => (
            <li key={entry.id} style={{ paddingLeft: `${Math.min(depth, 5) * 12}px` }}>
              <Button
                variant={entry.id === selected ? "secondary" : "ghost"}
                aria-pressed={entry.id === selected}
                disabled={pending}
                onClick={() => {
                  onSelect(entry.id);
                }}
                className="h-auto w-full min-w-0 justify-start border-l-2 border-l-border px-3 py-2.5 text-left whitespace-normal"
              >
                <span className="min-w-0">
                  <span className="block line-clamp-2 text-sm [overflow-wrap:anywhere]">
                    {entry.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {entry.id === history?.leafId
                      ? "Current position"
                      : tree.active.has(entry.id)
                        ? "Active branch"
                        : "Other branch"}
                    {branchPoint ? " · Branch point" : ""}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function useHistory(
  snapshot: SessionSnapshot,
  open: boolean,
): { history: SessionHistory | null; loading: boolean; error: string | null; refresh: () => void } {
  const { sessions } = useAppModel();
  const { key, connection } = snapshot;
  const query = open && connection === "connected" ? sessions.history(key) : inactiveHistory;
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(sessions.history(key));
  return {
    history: AsyncResult.getOrElse(result, () => null),
    loading: AsyncResult.isInitial(result) || result.waiting,
    error: requestFeedback(result),
    refresh,
  };
}

/** Browses persisted branches without changing the session until an explicit action. */
// oxlint-disable-next-line eslint/complexity -- The dialog coordinates selection and two distinct history actions.
export function SessionHistoryBrowser({
  snapshot,
  controlsPending,
  onFork,
}: {
  snapshot: SessionSnapshot;
  controlsPending: boolean;
  onFork: (entryId: HistoryEntryId) => Promise<void>;
}): ReactElement {
  const { sessions, composers } = useAppModel();
  const run = useRunCommand();
  const edit = useAtomSet(composers(snapshot.key).edit);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<HistoryEntryId | null>(null);
  const [pending, setPending] = useState<"navigate" | "fork" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { key, connection, execution } = snapshot;
  const {
    history,
    loading,
    error: historyError,
    refresh: refreshHistory,
  } = useHistory(snapshot, open);

  const selectedId = history?.entries.some((item) => item.id === selected)
    ? selected
    : (history?.leafId ?? null);
  const entry = history?.entries.find((item) => item.id === selectedId);
  const current = history?.entries.find((item) => item.id === history.leafId);
  const ready = connection === "connected" && !pending && !controlsPending && !loading && !!entry;

  async function act(action: "navigate" | "fork"): Promise<void> {
    if (!entry) return;
    setPending(action);
    setError(null);
    try {
      if (action === "fork") await onFork(entry.id);
      else {
        const text = await run(sessions.navigate(key, entry.id));
        if (text !== null) edit({ message: text, fromHistory: true });
      }
      setOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    setPending(null);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value && connection === "connected") refreshHistory();
      }}
    >
      <Dialog.Trigger
        render={<Button variant="ghost" size="sm" className="-ml-2 mt-2 text-muted-foreground" />}
      >
        <GitBranchIcon aria-hidden="true" />
        Conversation history
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl outline-none">
          <div className="shrink-0 border-b border-border p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-base font-semibold">Conversation history</Dialog.Title>
              <Dialog.Close
                render={<Button variant="ghost" size="icon" aria-label="Close history" />}
              >
                <XIcon aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              Browse without changing your session. Navigate within it or fork an independent copy.
            </Dialog.Description>
            <p className="mt-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              Current position: {current?.label ?? (loading ? "Loading…" : "Session root")}
            </p>
          </div>
          <div className="grid min-h-0 overflow-y-auto sm:grid-cols-[minmax(0,1fr)_18rem]">
            <HistoryEntries
              history={history}
              selected={selectedId}
              loading={loading}
              pending={!!pending}
              connected={connection === "connected"}
              onSelect={setSelected}
              onRefresh={() => {
                setError(null);
                refreshHistory();
              }}
            />
            <section
              aria-label="Selected history entry"
              className="min-w-0 space-y-4 border-t border-border bg-muted/20 p-4 sm:border-t-0 sm:border-l"
            >
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">Selected entry</h3>
                <p className="mt-2 max-h-24 overflow-y-auto text-sm [overflow-wrap:anywhere]">
                  {entry?.label ?? "Choose an entry to see available actions."}
                </p>
                {entry && (
                  <p
                    title={entry.id}
                    className="mt-2 truncate font-mono text-xs text-muted-foreground"
                  >
                    {entry.id}
                  </p>
                )}
              </div>
              <div>
                <Button
                  variant="outline"
                  disabled={!ready || execution !== "idle" || entry.id === history?.leafId}
                  aria-describedby="navigate-consequence"
                  onClick={() => void act("navigate")}
                >
                  <GitBranchIcon aria-hidden="true" />
                  {pending === "navigate" ? "Navigating…" : "Navigate"}
                </Button>
                <p
                  id="navigate-consequence"
                  className="mt-2 text-xs leading-relaxed text-muted-foreground"
                >
                  Move this session to the selected point when execution is confirmed idle. Original
                  history is preserved. Pi may return input to your draft.
                </p>
              </div>
              <div>
                <Button
                  variant="outline"
                  disabled={!ready}
                  aria-describedby="fork-consequence"
                  onClick={() => void act("fork")}
                >
                  <GitForkIcon aria-hidden="true" />
                  {pending === "fork" ? "Forking…" : "Fork session"}
                </Button>
                <p
                  id="fork-consequence"
                  className="mt-2 text-xs leading-relaxed text-muted-foreground"
                >
                  Open an independent session copied through this entry. Source work continues.
                  Unfinished output and runtime fork hooks are excluded.
                </p>
              </div>
              {connection !== "connected" && (
                <p role="alert" className="text-sm text-destructive">
                  Pi is disconnected. History may be stale; actions need a connection.
                </p>
              )}
              {(error ?? historyError) && (
                <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
                  {error ?? historyError}
                </p>
              )}
            </section>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
