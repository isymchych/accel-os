import { FolderIcon, InfoIcon, PanelLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import type {
  Prompt,
  SessionKey,
  SessionSnapshot,
  StoredSession,
  WorkspaceState,
} from "../contracts/index.ts";
import { AccountSelector } from "./account-selector.tsx";
import { useApi } from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import { SessionView, type ComposerFeedback } from "./session-view.tsx";
import { SessionsLibrary } from "./sessions-library.tsx";
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

function WorkspaceSidebar({ children }: { children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <aside className="flex max-h-[50dvh] min-h-0 flex-col overflow-y-auto border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:max-h-none md:border-r md:border-b-0">
      <div className="flex shrink-0 items-center gap-2 px-5 py-3 md:pt-5">
        <span
          className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
          aria-hidden="true"
        >
          P
        </span>
        <h1 className="text-base font-semibold tracking-tight">Pagoda</h1>
        <span className="ml-auto hidden text-xs text-muted-foreground md:block">Workspace</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto md:hidden"
          aria-expanded={open}
          aria-controls="workspace-sidebar"
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          <PanelLeftIcon aria-hidden="true" />
          Sessions
        </Button>
      </div>
      <div id="workspace-sidebar" className={open ? "contents" : "hidden md:contents"}>
        {children}
      </div>
    </aside>
  );
}

export function SessionScreen(): ReactElement {
  const workspace = useApi();
  const workspaceRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const navigationRevision = useRef(0);
  const catalogRevision = useRef(0);
  const previousExecution = useRef<Record<string, string>>({});
  useEffect(() => {
    workspaceRef.current?.focus({ preventScroll: true });
  }, []);
  const [selected, setSelected] = useState<SessionKey | null>(null);
  const [directory, setDirectory] = useState("");
  const [directoryInput, setDirectoryInput] = useState("");
  const [library, setLibrary] = useState(false);
  const [inactivityHours, setInactivityHours] = useState(48);
  const [now, setNow] = useState(Date.now);
  const [catalog, setCatalog] = useState<StoredSession[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [composers, setComposers] = useState<Record<SessionKey, ComposerState>>({});

  const refreshCatalog = useCallback(async (): Promise<void> => {
    catalogRevision.current += 1;
    const revision = catalogRevision.current;
    try {
      const items = await workspace.listAll();
      if (revision !== catalogRevision.current) return;
      setCatalog(items);
      setNow(Date.now());
      setFeedback(null);
    } catch (error) {
      if (revision === catalogRevision.current) setFeedback(errorMessage(error));
    }
  }, [workspace]);
  const onSnapshot = useCallback(
    (session: SessionSnapshot): void => {
      const previous = previousExecution.current[session.key];
      previousExecution.current[session.key] = session.execution;
      if ((previous === "running" || previous === "stopping") && session.execution === "idle") {
        void refreshCatalog();
      }
    },
    [refreshCatalog],
  );
  const onWorkspace = useCallback((initial: WorkspaceState): void => {
    const previous = saved("pi-selected");
    const key =
      initial.sessions.find((session) => session.key === previous)?.key ?? initial.initialKey;
    setSelected(key);
    setDirectory(initial.sessions.find((session) => session.key === key)?.cwd ?? "");
    setDirectoryInput(initial.sessions.find((session) => session.key === key)?.cwd ?? "");
    setInactivityHours(initial.inactivityHours);
  }, []);
  const { sessions, receive, metadata, selectedAccount, transportConnected } =
    useWorkspaceObservation(onWorkspace, onSnapshot);
  useEffect(() => {
    if (selected !== null) remember("pi-selected", selected);
  }, [selected]);

  const summaries = Object.values(sessions).flatMap((session) => (session ? [session] : []));
  const inactivityMs = inactivityHours * 60 * 60 * 1000;
  useEffect(() => {
    const deadlines = catalog
      .map((item) => Date.parse(item.modified) + inactivityMs)
      .filter((deadline) => deadline > now);
    if (deadlines.length === 0) return undefined;
    const delay = Math.min(Math.min(...deadlines) - now, 2_147_483_647);
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, delay);
    return (): void => {
      clearTimeout(timer);
    };
  }, [catalog, inactivityMs, now]);
  const isRecent = (id: string | null): boolean =>
    catalog.some((item) => item.id === id && Date.parse(item.modified) + inactivityMs > now);
  const isPinned = (id: string | null): boolean =>
    metadata.some((item) => item.id === id && item.pinned);
  const recentLive = summaries.filter(
    (session) =>
      !isPinned(session.sessionId) &&
      (session.key === selected ||
        !transportConnected ||
        session.execution !== "idle" ||
        Boolean(composers[session.key]?.message ?? saved(`pi-composer:${session.key}`)) ||
        isRecent(session.sessionId)),
  );
  const recentStored = catalog.filter(
    (item) =>
      !isPinned(item.id) &&
      isRecent(item.id) &&
      !summaries.some((session) => session.sessionId === item.id),
  );
  const connected = summaries.some((session) => session.connection === "connected");
  const missingPins = metadata
    .filter((item) => item.pinned && !catalog.some((session) => session.id === item.id))
    .map((item) => item.id)
    .toSorted()
    .join("\n");
  useEffect(() => {
    // Synchronize the catalog from the external Pi process.
    // oxlint-disable-next-line react/set-state-in-effect
    if (connected) void refreshCatalog();
  }, [connected, refreshCatalog]);
  useEffect(() => {
    // A different client may pin a session absent from this catalog.
    // oxlint-disable-next-line react/set-state-in-effect
    if (connected && missingPins) void refreshCatalog();
  }, [connected, missingPins, refreshCatalog]);

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
      await workspace.prompt({ key, message, mode });
      remember(`pi-composer:${key}`, "");
      sessionStorage.removeItem(`pi-submitting:${key}`);
      updateComposer(key, { message: "", feedback: null });
    } catch (error) {
      updateComposer(key, { feedback: { kind: "error", message: errorMessage(error) } });
    }
    updateComposer(key, { pending: false });
  }
  async function open(operation: () => Promise<SessionSnapshot>): Promise<void> {
    setOpening(true);
    setFeedback(null);
    navigationRevision.current += 1;
    const revision = navigationRevision.current;
    try {
      const next = await operation();
      receive(next);
      if (revision === navigationRevision.current) {
        setSelected(next.key);
        setLibrary(false);
      }
    } catch (error) {
      setFeedback(errorMessage(error));
    }
    setOpening(false);
  }

  return (
    <main
      ref={workspaceRef}
      tabIndex={-1}
      className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden outline-none md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1"
    >
      <WorkspaceSidebar>
        <AccountSelector selected={selectedAccount} connected={transportConnected} />
        <form
          className="space-y-2 px-4 py-3"
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
          <label
            htmlFor="working-directory"
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
          >
            <FolderIcon className="size-3.5" aria-hidden="true" />
            Working directory
          </label>
          <input
            id="working-directory"
            value={directoryInput}
            onChange={(event) => {
              setDirectoryInput(event.target.value);
            }}
            className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="submit"
              disabled={!transportConnected || !directoryInput.trim()}
            >
              Use directory
            </Button>
            <Button
              aria-label="Refresh sessions"
              size="icon"
              variant="ghost"
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
        <p className="sr-only">{directory}</p>
        <Button
          variant="outline"
          className="mx-4 mt-1 justify-start gap-2"
          disabled={!directory || opening || !transportConnected}
          onClick={() => {
            void open(async () => workspace.create(directory));
          }}
        >
          <PlusIcon aria-hidden="true" />
          New session
        </Button>
        <Button
          variant={library ? "secondary" : "ghost"}
          className="mx-4 mt-1 justify-start"
          onClick={() => {
            navigationRevision.current += 1;
            setLibrary(true);
            void refreshCatalog();
          }}
        >
          Browse sessions
        </Button>
        <div className="flex-1 space-y-6 px-3 py-6">
          <nav aria-label="Pinned sessions" className="space-y-1">
            <h2 className="mb-2 px-2 text-xs font-medium text-muted-foreground">Pinned</h2>
            {catalog
              .filter((item) => metadata.some((mark) => mark.id === item.id && mark.pinned))
              .map((item) => {
                const live = summaries.find((session) => session.sessionId === item.id);
                return (
                  <Button
                    key={item.path}
                    variant={!library && live?.key === selected ? "secondary" : "ghost"}
                    className="h-auto w-full justify-start whitespace-normal text-left"
                    disabled={opening || !transportConnected}
                    onClick={() => {
                      void open(async () => workspace.open(item.cwd, item.path));
                    }}
                  >
                    {item.name || item.id}
                  </Button>
                );
              })}
          </nav>
          <nav aria-label="Recent sessions" className="space-y-1">
            <h2 className="mb-2 px-2 text-xs font-medium text-muted-foreground">Recent</h2>
            {recentLive.map((session) => (
              <Button
                key={session.key}
                variant={!library && session.key === selected ? "secondary" : "ghost"}
                aria-current={!library && session.key === selected ? "page" : undefined}
                className="h-auto w-full justify-start gap-2.5 px-3 py-2.5 whitespace-normal text-left"
                onClick={() => {
                  navigationRevision.current += 1;
                  setSelected(session.key);
                  setLibrary(false);
                }}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${!transportConnected || session.connection !== "connected" || session.execution === "unknown" ? "bg-destructive" : session.execution === "running" || session.execution === "stopping" ? "bg-primary" : "bg-muted-foreground/50"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {session.name || "New session"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {transportConnected
                      ? `${session.connection} · ${session.execution}`
                      : "disconnected · unknown"}
                  </span>
                </span>
              </Button>
            ))}
            {recentStored.map((item) => (
              <Button
                key={item.path}
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal text-left"
                disabled={opening || !transportConnected}
                onClick={() => {
                  void open(async () => workspace.open(item.cwd, item.path));
                }}
              >
                {item.name || item.id}
              </Button>
            ))}
          </nav>
        </div>
        <div className="space-y-2 border-t border-sidebar-border p-3">
          <WorkspaceNavigation
            target={workspaceRef}
            composer={composerRef}
            transcript={transcriptRef}
            sessionKeys={summaries
              .filter((session) => isPinned(session.sessionId) || recentLive.includes(session))
              .map((session) => session.key)}
            selected={selected}
            onSelect={(key) => {
              navigationRevision.current += 1;
              setSelected(key);
              setLibrary(false);
            }}
          />
          <details className="px-2 text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 focus-visible:outline-2 focus-visible:outline-ring">
              <InfoIcon aria-hidden="true" className="size-3.5" />
              About this workspace
            </summary>
            <div className="space-y-2 py-2 leading-relaxed">
              <p>Pi tools run on your host without a sandbox. Unsupported dialogs are cancelled.</p>
              <p>
                Refreshing or closing this client keeps work running. Stop the backend to end all
                sessions.
              </p>
              <p>
                CLI/GUI handoff is sequential. Close a session in the terminal before opening it
                here.
              </p>
            </div>
          </details>
          {feedback && (
            <p role="alert" className="px-2 text-sm text-destructive">
              {feedback}
            </p>
          )}
        </div>
      </WorkspaceSidebar>
      <div className="flex min-h-0 min-w-0 flex-col">
        {!transportConnected && (
          <p
            role="alert"
            className="border-b border-destructive/20 bg-destructive/5 px-6 py-3 text-sm text-destructive"
          >
            Backend connection unavailable. Execution state is unknown; reconnecting…
          </p>
        )}
        {library ? (
          <SessionsLibrary
            catalog={catalog}
            sessions={summaries}
            metadata={metadata}
            disabled={opening || !transportConnected}
            onOpen={(session) => {
              void open(async () => workspace.open(session.cwd, session.path));
            }}
            onFlag={(id, flag, value) => {
              void workspace.setMetadataFlag(id, flag, value).catch((error: unknown) => {
                setFeedback(errorMessage(error));
              });
            }}
          />
        ) : snapshot ? (
          <SessionView
            key={snapshot.key}
            snapshot={snapshot}
            message={composer.message}
            pending={composer.pending}
            feedback={composer.feedback}
            composerRef={composerRef}
            transcriptRef={transcriptRef}
            onExitComposer={() => workspaceRef.current?.focus({ preventScroll: true })}
            onEdit={edit}
            onNavigateText={(key, text) => {
              remember(`pi-composer:${key}`, text);
              updateComposer(key, { message: text });
            }}
            onSubmit={(mode) => {
              void submit(mode);
            }}
            onFork={async (entryId) => {
              navigationRevision.current += 1;
              const revision = navigationRevision.current;
              const next = await workspace.fork(snapshot.key, entryId);
              receive(next);
              if (revision === navigationRevision.current) setSelected(next.key);
            }}
          />
        ) : (
          <output className="m-auto text-sm text-muted-foreground">Opening session…</output>
        )}
      </div>
    </main>
  );
}
