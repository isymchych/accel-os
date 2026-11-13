import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, type ReactElement } from "react";

import { useAppModel } from "../app/app-provider.tsx";
import { SessionView } from "../session/session-view.tsx";
import { useWorkspaceNavigation, type WorkspaceNavigationState } from "./navigation.ts";
import { SessionsLibrary } from "./sessions-library.tsx";
import { WorkspaceSidebar } from "./sidebar.tsx";

function Library({ navigation }: { navigation: WorkspaceNavigationState }): ReactElement {
  const { workspace, requests } = useAppModel();
  const result = useAtomValue(requests.catalog);
  const sessions = useAtomValue(workspace.summaries);
  const metadata = useAtomValue(workspace.metadata);
  const connected = useAtomValue(workspace.connected);
  return (
    <SessionsLibrary
      catalog={AsyncResult.getOrElse(result, () => [])}
      sessions={sessions}
      metadata={metadata}
      disabled={navigation.opening || !connected}
      onOpen={(session) => {
        void navigation.open(session.cwd, session.path);
      }}
    />
  );
}

/** Layout and navigation only; sidebar and selected session own their subscriptions. */
export function WorkspaceScreen(): ReactElement {
  const { workspace } = useAppModel();
  const connected = useAtomValue(workspace.connected);
  const navigation = useWorkspaceNavigation();
  const workspaceRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workspaceRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main
      ref={workspaceRef}
      tabIndex={-1}
      className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden outline-none md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1"
    >
      <WorkspaceSidebar
        navigation={navigation}
        workspaceRef={workspaceRef}
        composerRef={composerRef}
        transcriptRef={transcriptRef}
      />
      <div className="flex min-h-0 min-w-0 flex-col">
        {!connected && (
          <p
            role="alert"
            className="border-b border-destructive/20 bg-destructive/5 px-6 py-3 text-sm text-destructive"
          >
            Backend connection unavailable. Execution state is unknown; reconnecting…
          </p>
        )}
        {navigation.library ? (
          <Library navigation={navigation} />
        ) : navigation.selected === null ? (
          <output className="m-auto text-sm text-muted-foreground">Opening session…</output>
        ) : (
          <SessionView
            key={navigation.selected}
            sessionKey={navigation.selected}
            composerRef={composerRef}
            transcriptRef={transcriptRef}
            onFork={navigation.fork}
            onExitComposer={() => workspaceRef.current?.focus({ preventScroll: true })}
          />
        )}
      </div>
    </main>
  );
}
