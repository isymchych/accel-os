import { FolderOpenIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type {
  Prompt,
  SessionKey,
  SessionSnapshot,
  SessionSummary,
  StoredSession,
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
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* In-memory state remains available. */
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The desktop operation failed.";
}

export function SessionScreen(): ReactElement {
  const { workspace, native } = useApi();
  const workspaceRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    workspaceRef.current?.focus({ preventScroll: true });
  }, []);
  const [selected, setSelected] = useState<SessionKey | null>(null);
  const [directory, setDirectory] = useState("");
  const [listing, setListing] = useState<{ cwd: string; items: StoredSession[] }>({
    cwd: "",
    items: [],
  });
  const catalog = listing.cwd === directory ? listing.items : [];
  const [feedback, setFeedback] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [composers, setComposers] = useState<Record<SessionKey, ComposerState>>({});

  const onWorkspace = useCallback(
    (initial: { initialKey: SessionKey; sessions: SessionSummary[] }): void => {
      const previous = saved("pi-selected");
      const key =
        initial.sessions.find((session) => session.key === previous)?.key ?? initial.initialKey;
      setSelected(key);
      setDirectory(initial.sessions.find((session) => session.key === key)?.cwd ?? "");
    },
    [],
  );
  const onObservationError = useCallback((error: unknown): void => {
    setFeedback(errorMessage(error));
  }, []);
  const { sessions, receive } = useWorkspaceObservation(selected, onWorkspace, onObservationError);
  useEffect(() => {
    if (selected !== null) remember("pi-selected", selected);
  }, [selected]);

  const summaries = Object.values(sessions).flatMap((session) =>
    session ? [session.summary] : [],
  );
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

  const snapshot = selected === null ? undefined : sessions[selected]?.snapshot;
  const composer = (selected === null ? undefined : composers[selected]) ?? {
    message: selected === null ? "" : saved(`pi-composer:${selected}`),
    pending: false,
    feedback: null,
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
    remember(`pi-composer:${selected}`, message);
    updateComposer(selected, { message });
  }
  async function submit(mode: Prompt["mode"]): Promise<void> {
    const key = selected;
    if (key === null) return;
    const message = composer.message;
    updateComposer(key, { pending: true, feedback: null });
    try {
      const disposition = await workspace.prompt({ key, message, mode });
      remember(`pi-composer:${key}`, "");
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void native
                .chooseDirectory()
                .then((cwd) => {
                  if (cwd) {
                    setDirectory(cwd);
                    setFeedback(null);
                  }
                })
                .catch((error: unknown) => {
                  setFeedback(errorMessage(error));
                });
            }}
          >
            <FolderOpenIcon aria-hidden="true" />
            Choose directory
          </Button>
          <Button
            aria-label="Refresh sessions"
            size="icon"
            variant="outline"
            disabled={!connected}
            onClick={() => {
              void refreshCatalog();
            }}
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        </div>
        <p className="my-3 break-all text-xs text-muted-foreground">
          {directory || "Opening directory…"}
        </p>
        <Button
          disabled={!directory || opening}
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
                  {session.connection} · {session.execution}
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
              disabled={opening}
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
