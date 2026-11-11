import { FolderOpenIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type { Prompt, SessionSnapshot, SessionSummary, StoredSession } from "../desktop-api.ts";
import { Button } from "./components/ui/button.tsx";
import { SessionView } from "./session-view.tsx";
import { WorkspaceNavigation } from "./workspace-navigation.tsx";

interface ComposerState {
  message: string;
  pending: boolean;
  feedback: string | null;
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
  const workspaceRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    workspaceRef.current?.focus({ preventScroll: true });
  }, []);
  const [sessions, setSessions] = useState<Record<string, SessionSummary>>({});
  const [snapshots, setSnapshots] = useState<Record<string, SessionSnapshot>>({});
  const [selected, setSelected] = useState(() => saved("pi-selected"));
  const [directory, setDirectory] = useState("");
  const [listing, setListing] = useState<{ cwd: string; items: StoredSession[] }>({
    cwd: "",
    items: [],
  });
  const catalog = listing.cwd === directory ? listing.items : [];
  const [feedback, setFeedback] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [composers, setComposers] = useState<Record<string, ComposerState>>({});

  const receive = useCallback((next: SessionSnapshot): void => {
    setSnapshots((current) =>
      next.revision >= (current[next.key]?.revision ?? -1)
        ? { ...current, [next.key]: next }
        : current,
    );
    setSessions((current) =>
      next.revision >= (current[next.key]?.revision ?? -1)
        ? { ...current, [next.key]: next }
        : current,
    );
  }, []);
  useEffect(() => {
    remember("pi-selected", selected);
  }, [selected]);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.pi.subscribe((next) => {
      if (active) receive(next);
    });
    void window.pi
      .workspace()
      .then((workspace) => {
        if (!active) return;
        setSessions((current) => {
          const next = { ...current };
          for (const session of workspace.sessions) {
            if (session.revision >= (next[session.key]?.revision ?? -1))
              next[session.key] = session;
          }
          return next;
        });
        const previous = saved("pi-selected");
        const key = workspace.sessions.some((session) => session.key === previous)
          ? previous
          : workspace.initialKey;
        setSelected(key);
        setDirectory(workspace.sessions.find((session) => session.key === key)?.cwd ?? "");
      })
      .catch((error: unknown) => {
        if (active) setFeedback(errorMessage(error));
      });
    return (): void => {
      active = false;
      unsubscribe();
    };
  }, [receive]);

  useEffect(() => {
    if (!selected) return undefined;
    let active = true;
    void window.pi
      .snapshot(selected)
      .then((next) => {
        if (active) receive(next);
      })
      .catch((error: unknown) => {
        if (active) setFeedback(errorMessage(error));
      });
    return (): void => {
      active = false;
    };
  }, [selected, receive]);

  const connected = Object.values(sessions).some((session) => session.connection === "connected");
  useEffect(() => {
    if (!directory || !connected) return undefined;
    let active = true;
    void window.pi
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
  }, [directory, connected]);

  const snapshot = snapshots[selected];
  const composer = composers[selected] ?? {
    message: saved(`pi-composer:${selected}`),
    pending: false,
    feedback: null,
  };
  function updateComposer(key: string, change: Partial<ComposerState>): void {
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
    remember(`pi-composer:${selected}`, message);
    updateComposer(selected, { message });
  }
  async function submit(mode: Prompt["mode"]): Promise<void> {
    const key = selected;
    const message = composer.message;
    updateComposer(key, { pending: true, feedback: null });
    try {
      const disposition = await window.pi.prompt({ key, message, mode });
      remember(`pi-composer:${key}`, "");
      updateComposer(key, { message: "", feedback: `Input: ${disposition}.` });
    } catch (error) {
      updateComposer(key, { feedback: errorMessage(error) });
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
      setListing({ cwd: directory, items: await window.pi.list(directory) });
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
        <h1 className="mb-5 text-lg font-semibold">Pi workspace</h1>
        <WorkspaceNavigation
          target={workspaceRef}
          composer={composerRef}
          sessionKeys={Object.keys(sessions)}
          selected={selected}
          onSelect={setSelected}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void window.pi
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
            void open(async () => window.pi.create(directory));
          }}
        >
          <PlusIcon aria-hidden="true" />
          New conversation
        </Button>
        <nav aria-label="Open conversations" className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            Open conversations
          </h2>
          {Object.values(sessions).map((session) => (
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
                <span className="block truncate">{session.name || "New conversation"}</span>
                <span className="block text-xs text-muted-foreground">
                  {session.connection} · {session.execution}
                </span>
              </span>
            </Button>
          ))}
        </nav>
        <section aria-label="Saved conversations" className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            Saved conversations
          </h2>
          {catalog.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No saved conversations in this directory.
            </p>
          )}
          {catalog.map((session) => (
            <Button
              key={session.path}
              variant="ghost"
              disabled={opening}
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() => {
                void open(async () => window.pi.open(session.cwd, session.path));
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
              void open(async () => window.pi.fork(snapshot.key, entryId));
            }}
          />
        ) : (
          <output>Opening conversation…</output>
        )}
      </div>
    </main>
  );
}
