import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { FolderIcon, InfoIcon, PanelLeftIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState, type ReactElement, type ReactNode, type RefObject } from "react";

import { useAppModel } from "../app/app-provider.tsx";
import { Button } from "../components/ui/button.tsx";
import { requestFeedback } from "../transport/errors.ts";
import { AccountSelector } from "./account-selector.tsx";
import { WorkspaceNavigation } from "./keyboard-navigation.tsx";
import type { WorkspaceNavigationState } from "./navigation.ts";
import { sidebarItems } from "./sidebar-items.ts";

function SidebarLayout({ children }: { children: ReactNode }): ReactElement {
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

export function WorkspaceSidebar({
  navigation,
  workspaceRef,
  composerRef,
  transcriptRef,
}: {
  navigation: WorkspaceNavigationState;
  workspaceRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  transcriptRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const model = useAppModel();
  const { workspace, requests } = model;
  const summaries = useAtomValue(workspace.summaries);
  const metadata = useAtomValue(workspace.metadata);
  const selectedAccount = useAtomValue(workspace.selectedAccount);
  const transportConnected = useAtomValue(workspace.connected);
  const initial = useAtomValue(workspace.initial);
  const draftOwners = useAtomValue(model.draftOwners);
  const catalogResult = useAtomValue(requests.catalog);
  const catalog = AsyncResult.getOrElse(catalogResult, () => []);
  const refreshCatalog = useAtomRefresh(requests.catalog);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    // A manual catalog refresh also resynchronizes the sidebar's expiry clock.
    // oxlint-disable-next-line react/set-state-in-effect
    if (AsyncResult.isSuccess(catalogResult) && !catalogResult.waiting) setNow(Date.now());
  }, [catalogResult]);
  const items = sidebarItems({
    sessions: summaries,
    catalog,
    metadata,
    selected: navigation.selected,
    connected: transportConnected,
    draftOwners,
    inactivityHours: initial?.inactivityHours ?? 48,
    now,
  });
  const { nextExpiry } = items;
  useEffect(() => {
    if (nextExpiry === null) return undefined;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
      },
      Math.min(nextExpiry - now, 2_147_483_647),
    );
    return (): void => {
      clearTimeout(timer);
    };
  }, [nextExpiry, now]);
  const connected = summaries.some((session) => session.connection === "connected");
  const feedback = navigation.feedback ?? requestFeedback(catalogResult);
  return (
    <SidebarLayout>
      <AccountSelector selected={selectedAccount} connected={transportConnected} />
      <form
        className="space-y-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void navigation.validateDirectory();
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
          value={navigation.directoryInput}
          onChange={(event) => {
            navigation.setDirectoryInput(event.target.value);
          }}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="submit"
            disabled={!transportConnected || !navigation.directoryInput.trim()}
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
              refreshCatalog();
            }}
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        </div>
      </form>
      <p className="sr-only">{navigation.directory}</p>
      <Button
        variant="outline"
        className="mx-4 mt-1 justify-start gap-2"
        disabled={!navigation.directory || navigation.opening || !transportConnected}
        onClick={() => {
          void navigation.create();
        }}
      >
        <PlusIcon aria-hidden="true" />
        New session
      </Button>
      <Button
        variant={navigation.library ? "secondary" : "ghost"}
        className="mx-4 mt-1 justify-start"
        onClick={() => {
          navigation.browse();
        }}
      >
        Browse sessions
      </Button>
      <div className="flex-1 space-y-6 px-3 py-6">
        <nav aria-label="Pinned sessions" className="space-y-1">
          <h2 className="mb-2 px-2 text-xs font-medium text-muted-foreground">Pinned</h2>
          {items.pinned.map((item) => {
            const live = summaries.find((session) => session.sessionId === item.id);
            return (
              <Button
                key={item.path}
                variant={
                  !navigation.library && live?.key === navigation.selected ? "secondary" : "ghost"
                }
                className="h-auto w-full justify-start whitespace-normal text-left"
                disabled={navigation.opening || !transportConnected}
                onClick={() => {
                  void navigation.open(item.cwd, item.path);
                }}
              >
                {item.name || item.id}
              </Button>
            );
          })}
        </nav>
        <nav aria-label="Recent sessions" className="space-y-1">
          <h2 className="mb-2 px-2 text-xs font-medium text-muted-foreground">Recent</h2>
          {items.recentLive.map((session) => (
            <Button
              key={session.key}
              variant={
                !navigation.library && session.key === navigation.selected ? "secondary" : "ghost"
              }
              aria-current={
                !navigation.library && session.key === navigation.selected ? "page" : undefined
              }
              className="h-auto w-full justify-start gap-2.5 px-3 py-2.5 whitespace-normal text-left"
              onClick={() => {
                navigation.select(session.key);
              }}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${!transportConnected || session.connection !== "connected" || session.execution === "unknown" ? "bg-destructive" : session.execution === "running" || session.execution === "stopping" ? "bg-primary" : "bg-muted-foreground/50"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{session.name || "New session"}</span>
                <span className="block text-xs text-muted-foreground">
                  {transportConnected
                    ? `${session.connection} · ${session.execution}`
                    : "disconnected · unknown"}
                </span>
              </span>
            </Button>
          ))}
          {items.recentStored.map((item) => (
            <Button
              key={item.path}
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal text-left"
              disabled={navigation.opening || !transportConnected}
              onClick={() => {
                void navigation.open(item.cwd, item.path);
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
          sessionKeys={items.sessionKeys}
          selected={navigation.selected}
          onSelect={(key) => {
            navigation.select(key);
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
              CLI/GUI handoff is sequential. Close a session in the terminal before opening it here.
            </p>
          </div>
        </details>
        {feedback && (
          <p role="alert" className="px-2 text-sm text-destructive">
            {feedback}
          </p>
        )}
      </div>
    </SidebarLayout>
  );
}
