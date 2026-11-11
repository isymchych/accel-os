import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type {
  Prompt,
  SessionKey,
  SessionSnapshot,
  StoredSession,
  WorkspaceState,
} from "../desktop-api.ts";
import { useApi } from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import { SessionView, type ComposerFeedback } from "./session-view.tsx";
import { useWorkspaceObservation } from "./use-workspace-observation.ts";
import { WorkspaceNavigation } from "./workspace-navigation.tsx";

interface ComposerState {
  message: string;
  pending: boolean;
  feedback: ComposerFeedback | null;
}
function saved(key: string): string {
  return sessionStorage.getItem(key) ?? "";
}
function remember(key: string, value: string): void {
  sessionStorage.setItem(key, value);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The workspace operation failed.";
}

export function SessionScreen(): ReactElement {
  const workspace = useApi();
  const workspaceRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    workspaceRef.current?.focus({ preventScroll: true });
  }, []);
  const [selected, setSelected] = useState<SessionKey | null>(null);
  const [directory, setDirectory] = useState("");
  const [directoryInput, setDirectoryInput] = useState("");
  const [listing, setListing] = useState<{ cwd: string; items: StoredSession[] }>({
    cwd: "",
    items: [],
  });
  const catalog = listing.cwd === directory ? listing.items : [];
  const [feedback, setFeedback] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [composers, setComposers] = useState<Record<SessionKey, ComposerState>>({});

  const onWorkspace = useCallback((initial: WorkspaceState): void => {
    const previous = saved("pi-selected");
    const key =
      initial.sessions.find((session) => session.key === previous)?.key ?? initial.initialKey;
    setSelected(key);
    setDirectory(initial.sessions.find((session) => session.key === key)?.cwd ?? "");
    setDirectoryInput(initial.sessions.find((session) => session.key === key)?.cwd ?? "");
  }, []);
  const { sessions, receive, transportConnected } = useWorkspaceObservation(onWorkspace);
  useEffect(() => {
    if (selected !== null) remember("pi-selected", selected);
  }, [selected]);

  const summaries = Object.values(sessions).flatMap((session) => (session ? [session] : []));
  const connected = summaries.some((session) => session.connection === "connected");
  useEffect(() => {
    if (!directory || !connected) return undefined;
    let active = true;
    void workspace
      .list(directory)
      .then((items) => {
        if (active) setListing({ cwd: directory, items });
      })
      .catch((error: unknown) => {
        if (active) setFeedback(errorMessage(error));
      });
    return (): void => {
      active = false;
    };
  }, [workspace, directory, connected]);

  const observed = selected === null ? undefined : sessions[selected];
  const snapshot =
    observed && !transportConnected
      ? { ...observed, connection: "disconnected" as const, execution: "unknown" as const }
      : observed;
  const composer = (selected === null ? undefined : composers[selected]) ?? {
    message: selected === null ? "" : saved(`pi-composer:${selected}`),
    pending: false,
    feedback:
      selected !== null && saved(`pi-submitting:${selected}`)
        ? {
            kind: "error" as const,
            message:
              "The submission may have been rejected or its outcome is uncertain; it was not retried.",
          }
        : null,
  };
  function updateComposer(key: SessionKey, change: Partial<ComposerState>): void {
    setComposers((current) => ({
      ...current,
      [key]: {
        message: saved(`pi-composer:${key}`),
        pending: false,
        feedback: null,
        ...current[key],
        ...change,
      },
    }));
  }
  function edit(message: string): void {
    if (selected === null) return;
    sessionStorage.removeItem(`pi-submitting:${selected}`);
    remember(`pi-composer:${selected}`, message);
    updateComposer(selected, { message, feedback: null });
  }
  async function submit(mode: Prompt["mode"]): Promise<void> {
    const key = selected;
    if (key === null) return;
    const message = composer.message;
    remember(`pi-submitting:${key}`, "pending");
    updateComposer(key, { pending: true, feedback: null });
    try {
      const disposition = await workspace.prompt({ key, message, mode });
      remember(`pi-composer:${key}`, "");
      sessionStorage.removeItem(`pi-submitting:${key}`);
      updateComposer(key, { message: "", feedback: { kind: "accepted", disposition } });
    } catch (error) {
      updateComposer(key, { feedback: { kind: "error", message: errorMessage(error) } });
    }
    updateComposer(key, { pending: false });
  }
  async function open(operation: () => Promise<SessionSnapshot>): Promise<void> {
    setOpening(true);
    setFeedback(null);
    const previous = selected;
    try {
      const next = await operation();
      receive(next);
      setSelected((current) => (current === previous ? next.key : current));
    } catch (error) {
      setFeedback(errorMessage(error));
    }
    setOpening(false);
  }
  async function refreshCatalog(): Promise<void> {
    try {
      setListing({ cwd: directory, items: await workspace.list(directory) });
      setFeedback(null);
    } catch (error) {
      setFeedback(errorMessage(error));
    }
  }

  return (
    <main
      ref={workspaceRef}
      tabIndex={-1}
      className="grid min-h-screen outline-none md:grid-cols-[18rem_minmax(0,1fr)]"
    >
      <aside className="border-b border-border bg-sidebar p-4 md:border-r md:border-b-0">
        <h1 className="mb-5 text-lg font-semibold">Pagoda</h1>
        <WorkspaceNavigation
          target={workspaceRef}
          composer={composerRef}
          sessionKeys={summaries.map((session) => session.key)}
          selected={selected}
          onSelect={setSelected}
        />
        <form
          className="my-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void workspace
              .directory(directoryInput)
              .then((cwd) => {
                setDirectory(cwd);
                setDirectoryInput(cwd);
                setFeedback(null);
              })
              .catch((error: unknown) => {
                setFeedback(errorMessage(error));
              });
          }}
        >
          <label htmlFor="working-directory" className="block text-xs text-muted-foreground">
            Working directory
          </label>
          <input
            id="working-directory"
            value={directoryInput}
            onChange={(event) => {
              setDirectoryInput(event.target.value);
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              type="submit"
              disabled={!transportConnected || !directoryInput.trim()}
            >
              Use directory
            </Button>
            <Button
              aria-label="Refresh sessions"
              size="icon"
              variant="outline"
              type="button"
              disabled={!connected || !transportConnected}
              onClick={() => {
                void refreshCatalog();
              }}
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
          </div>
        </form>
        <p className="my-3 break-all text-xs text-muted-foreground">
          {directory || "Opening directory…"}
        </p>
        <Button
          disabled={!directory || opening || !transportConnected}
          onClick={() => {
            void open(async () => workspace.create(directory));
          }}
        >
          <PlusIcon aria-hidden="true" />
          New session
        </Button>
        <nav aria-label="Open sessions" className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">Open sessions</h2>
          {summaries.map((session) => (
            <Button
              key={session.key}
              variant={session.key === selected ? "secondary" : "ghost"}
              aria-current={session.key === selected ? "page" : undefined}
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() => {
                setSelected(session.key);
              }}
            >
              <span className="min-w-0">
                <span className="block truncate">{session.name || "New session"}</span>
                <span className="block text-xs text-muted-foreground">
                  {transportConnected
                    ? `${session.connection} · ${session.execution}`
                    : "disconnected · unknown"}
                </span>
              </span>
            </Button>
          ))}
        </nav>
        <section aria-label="Saved sessions" className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">Saved sessions</h2>
          {catalog.length === 0 && (
            <p className="text-xs text-muted-foreground">No saved sessions in this directory.</p>
          )}
          {catalog.map((session) => (
            <Button
              key={session.path}
              variant="ghost"
              disabled={opening || !transportConnected}
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() => {
                void open(async () => workspace.open(session.cwd, session.path));
              }}
            >
              <span className="min-w-0">
                <span className="block truncate">{session.name || session.id}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(session.modified).toLocaleString()}
                </span>
              </span>
            </Button>
          ))}
        </section>
        <p className="mt-6 text-xs text-muted-foreground">
          CLI/GUI handoff is sequential. Close a session in the terminal before opening it here.
        </p>
        {feedback && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {feedback}
          </p>
        )}
      </aside>
      <div className="min-w-0 p-5 lg:px-10">
        {!transportConnected && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            Backend connection unavailable. Execution state is unknown; reconnecting…
          </p>
        )}
        {snapshot ? (
          <SessionView
            key={snapshot.key}
            snapshot={snapshot}
            message={composer.message}
            pending={composer.pending}
            feedback={composer.feedback}
            composerRef={composerRef}
            onExitComposer={() => workspaceRef.current?.focus({ preventScroll: true })}
            onEdit={edit}
            onNavigateText={(key, text) => {
              remember(`pi-composer:${key}`, text);
              updateComposer(key, { message: text });
            }}
            onSubmit={(mode) => {
              void submit(mode);
            }}
            onFork={(entryId) => {
              void open(async () => workspace.fork(snapshot.key, entryId));
            }}
          />
        ) : (
          <output>Opening session…</output>
        )}
      </div>
    </main>
  );
}
