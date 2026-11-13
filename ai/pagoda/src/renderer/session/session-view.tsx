import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { ReactElement, ReactNode, RefObject } from "react";

import type { HistoryEntryId, SessionKey, SessionSnapshot } from "../../contracts/index.ts";
import { useAppModel } from "../app/app-provider.tsx";
import { requestFeedback } from "../transport/errors.ts";
import { SessionComposer } from "./composer.tsx";
import { ModelControls } from "./controls.tsx";
import { SessionHistoryBrowser } from "./history.tsx";
import { TranscriptPane } from "./transcript.tsx";

function SessionHeader({
  snapshot,
  queued,
  children,
}: {
  snapshot: SessionSnapshot;
  queued: number;
  children: ReactNode;
}): ReactElement {
  const { connection, execution } = snapshot;
  return (
    <header className="shrink-0 border-b border-border px-5 py-4 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">
            {snapshot.name || "New session"}
          </h2>
          <p title={snapshot.cwd} className="mt-1 truncate text-xs text-muted-foreground">
            {snapshot.cwd}
          </p>
        </div>
        <output className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${connection !== "connected" || execution === "unknown" ? "bg-destructive" : execution === "running" || execution === "stopping" ? "bg-primary" : "bg-muted-foreground/50"}`}
          />
          <span className="sr-only">Connection: </span>
          {connection}
          <span aria-hidden="true">·</span>
          <span className="sr-only">Execution: </span>
          {execution}
          {queued > 0 && (
            <span className="rounded-md bg-muted px-2 py-1">{queued} queued inputs</span>
          )}
        </output>
      </div>
      {children}
    </header>
  );
}

export function SessionView({
  sessionKey,
  onFork,
  transcriptRef,
  composerRef,
  onExitComposer,
}: {
  sessionKey: SessionKey;
  onFork: (key: SessionKey, entryId: HistoryEntryId) => Promise<void>;
  transcriptRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onExitComposer: () => void;
}): ReactElement {
  const { workspace } = useAppModel();
  const snapshot = useAtomValue(workspace.session(sessionKey));
  return snapshot ? (
    <SessionContent
      snapshot={snapshot}
      onFork={onFork}
      transcriptRef={transcriptRef}
      composerRef={composerRef}
      onExitComposer={onExitComposer}
    />
  ) : (
    <output className="m-auto text-sm text-muted-foreground">Opening session…</output>
  );
}

function SessionContent({
  snapshot,
  onFork,
  transcriptRef,
  composerRef,
  onExitComposer,
}: {
  snapshot: SessionSnapshot;
  onFork: (key: SessionKey, entryId: HistoryEntryId) => Promise<void>;
  transcriptRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onExitComposer: () => void;
}): ReactElement {
  const { sessions } = useAppModel();
  const { key, connection, execution } = snapshot;
  const controlsResult = useAtomValue(sessions.controls(key));
  const controls = AsyncResult.getOrElse(controlsResult, () => null);
  const [mutation, change] = useAtom(sessions.changeControls(key));
  const pending = mutation.waiting;
  const feedback = requestFeedback(mutation, true) ?? requestFeedback(controlsResult);
  const idle = connection === "connected" && execution === "idle" && !pending;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader snapshot={snapshot} queued={controls?.pendingMessageCount ?? 0}>
        <SessionHistoryBrowser
          snapshot={snapshot}
          controlsPending={pending}
          onFork={(entryId) => onFork(key, entryId)}
        />
      </SessionHeader>
      <TranscriptPane snapshot={snapshot} transcriptRef={transcriptRef} />
      <div className="shrink-0 px-4 pb-4 pt-2 lg:px-8 lg:pb-6">
        <div className="mx-auto max-w-4xl">
          {snapshot.activity && (
            <p className="mb-2 px-2 text-xs text-muted-foreground">{snapshot.activity}</p>
          )}
          <SessionComposer
            snapshot={snapshot}
            composerRef={composerRef}
            onExitComposer={onExitComposer}
            modelControls={
              <section
                aria-label="Session controls"
                className="min-w-0 basis-full lg:basis-auto lg:flex-1"
              >
                <ModelControls controls={controls} idle={idle} change={change} />
                {feedback && (
                  <p role="alert" className="px-2 py-1 text-sm text-destructive">
                    {feedback}
                  </p>
                )}
              </section>
            }
          />
        </div>
      </div>
    </div>
  );
}
