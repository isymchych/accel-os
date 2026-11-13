import { Menu } from "@base-ui/react/menu";
import { ArrowUpIcon, ChevronDownIcon, SquareIcon } from "lucide-react";
import { useEffect, useState, type ReactElement, type ReactNode, type RefObject } from "react";

import type {
  HistoryEntryId,
  Prompt,
  SessionControls,
  SessionKey,
  SessionSnapshot,
} from "../contracts/index.ts";
import { useApi } from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import { SessionHistoryBrowser } from "./session-history.tsx";
import { TranscriptPane } from "./transcript.tsx";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Pi did not confirm this operation.";
}

function ModelControls({
  controls,
  idle,
  sessionKey,
  change,
}: {
  controls: SessionControls | null;
  idle: boolean;
  sessionKey: SessionKey;
  change: (operation: () => Promise<void>) => Promise<void>;
}): ReactElement {
  const workspace = useApi();
  if (!controls) return <p className="text-xs text-muted-foreground">Loading model controls…</p>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="min-w-0">
        <span id="model-label" className="sr-only">
          Model
        </span>
        <Select
          disabled={!idle}
          value={
            controls.model ? JSON.stringify([controls.model.provider, controls.model.id]) : null
          }
          onValueChange={(value) => {
            const model = controls.models.find(
              (item) => JSON.stringify([item.provider, item.id]) === value,
            );
            if (model)
              void change(async () => {
                await workspace.model(sessionKey, model.provider, model.id);
              });
          }}
        >
          <SelectTrigger
            aria-labelledby="model-label"
            className="max-w-[min(18rem,60vw)] border-transparent bg-transparent text-xs text-muted-foreground hover:text-foreground dark:bg-transparent"
          >
            <SelectValue placeholder="Select model">
              {controls.model ? `${controls.model.provider}/${controls.model.id}` : "Select model"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {controls.models.map((model) => (
              <SelectItem
                key={JSON.stringify([model.provider, model.id])}
                value={JSON.stringify([model.provider, model.id])}
              >
                {model.provider}/{model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <span id="thinking-label" className="sr-only">
          Thinking
        </span>
        <Select
          disabled={!idle}
          value={controls.thinkingLevel}
          onValueChange={(value) => {
            if (value)
              void change(async () => {
                await workspace.thinking(sessionKey, value);
              });
          }}
        >
          <SelectTrigger
            aria-labelledby="thinking-label"
            className="border-transparent bg-transparent text-xs text-muted-foreground hover:text-foreground dark:bg-transparent"
          >
            <SelectValue placeholder="Thinking level">
              Thinking: {controls.thinkingLevel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {controls.levels.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

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

export function SessionView(
  props: ComposerProps & {
    transcriptRef: RefObject<HTMLDivElement | null>;
    onFork: (entryId: HistoryEntryId) => Promise<void>;
    onNavigateText: (key: SessionKey, text: string) => void;
  },
): ReactElement {
  const { snapshot, onFork, onNavigateText, transcriptRef } = props;
  const workspace = useApi();
  const [controls, setControls] = useState<SessionControls | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { key, connection, execution } = snapshot;
  const { controlsRevision } = snapshot;

  useEffect(() => {
    if (connection !== "connected") return undefined;
    let active = true;
    void workspace
      .controls(key)
      .then((next) => {
        if (!active) return;
        setControls(next);
      })
      .catch((error: unknown) => {
        if (active) setFeedback(errorText(error));
      });
    return (): void => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The revision invalidates server-owned controls.
  }, [workspace, key, connection, controlsRevision]);

  async function change(operation: () => Promise<void>): Promise<void> {
    setPending(true);
    setFeedback(null);
    try {
      await operation();
    } catch (error) {
      setFeedback(errorText(error));
    }
    setPending(false);
  }
  const idle = connection === "connected" && execution === "idle" && !pending;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader snapshot={snapshot} queued={controls?.pendingMessageCount ?? 0}>
        <SessionHistoryBrowser
          snapshot={snapshot}
          controlsPending={pending}
          onFork={onFork}
          onNavigateText={onNavigateText}
        />
      </SessionHeader>
      <TranscriptPane snapshot={snapshot} transcriptRef={transcriptRef} />
      <div className="shrink-0 px-4 pb-4 pt-2 lg:px-8 lg:pb-6">
        <div className="mx-auto max-w-4xl">
          {snapshot.activity && (
            <p className="mb-2 px-2 text-xs text-muted-foreground">{snapshot.activity}</p>
          )}
          <SessionComposer
            {...props}
            modelControls={
              <section
                aria-label="Session controls"
                className="min-w-0 basis-full lg:basis-auto lg:flex-1"
              >
                <ModelControls controls={controls} idle={idle} sessionKey={key} change={change} />
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

export interface ComposerFeedback {
  kind: "error";
  message: string;
}

interface ComposerProps {
  snapshot: SessionSnapshot;
  message: string;
  pending: boolean;
  feedback: ComposerFeedback | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onExitComposer: () => void;
  onEdit: (message: string) => void;
  onSubmit: (mode: Prompt["mode"]) => void;
}

function SessionComposer({
  snapshot,
  message,
  pending,
  feedback,
  onEdit,
  onSubmit,
  composerRef,
  onExitComposer,
  modelControls,
}: ComposerProps & { modelControls: ReactElement }): ReactElement {
  const workspace = useApi();
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const ready = snapshot.connection === "connected";
  const stopping = stopPending || snapshot.execution === "stopping";
  const busy = snapshot.execution === "running" || stopping;
  const canInput =
    ready && !pending && !stopping && snapshot.execution !== "unknown" && message.trim().length > 0;
  const submissionError = feedback?.message;
  const errors = [...new Set([submissionError, stopError, snapshot.error].filter(Boolean))];
  // Acceptance is not completion. Execution and queue length live in the header.
  // Keep extension notices, not duplicate RPC receipts.
  const notice = ["Input: started.", "Input: queued."].includes(snapshot.notice ?? "")
    ? null
    : snapshot.notice === "Input: handled."
      ? "Input handled by Pi. This does not confirm that work completed."
      : snapshot.notice;
  return (
    <section aria-label="Direct agent">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canInput && !busy) onSubmit("prompt");
        }}
        className="rounded-2xl border border-input bg-card p-2 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15"
      >
        <label htmlFor="message" className="sr-only">
          Message
        </label>
        <Textarea
          ref={composerRef}
          id="message"
          className="max-h-[25dvh] min-h-24 resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-3 py-3 text-sm shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
          placeholder="Ask Pi…"
          readOnly={pending}
          required
          value={message}
          onChange={(event) => {
            onEdit(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              onExitComposer();
            }
          }}
        />
        <div className="flex flex-wrap items-end justify-between gap-2">
          {modelControls}
          <div className="ml-auto flex items-center gap-1">
            {busy ? (
              <>
                <Button
                  disabled={!canInput}
                  type="button"
                  variant="secondary"
                  title="Queue input until current work finishes"
                  onClick={() => {
                    onSubmit("follow_up");
                  }}
                >
                  Follow up
                </Button>
                <Button
                  disabled={!canInput}
                  type="button"
                  variant="secondary"
                  title="Deliver input at Pi's next steering boundary"
                  onClick={() => {
                    onSubmit("steer");
                  }}
                >
                  Steer
                </Button>
                <Button
                  disabled={!ready || stopping}
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    setStopError(null);
                    setStopPending(true);
                    void workspace
                      .stop(snapshot.key)
                      .catch((error: unknown) => {
                        setStopError(errorText(error));
                      })
                      .finally(() => {
                        setStopPending(false);
                      });
                  }}
                >
                  <SquareIcon aria-hidden="true" />
                  {stopping ? "Stopping…" : "Stop"}
                </Button>
              </>
            ) : (
              <>
                <Button disabled={!canInput} type="submit" className="gap-2 rounded-xl px-4">
                  {pending ? "Sending…" : "Send"}
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Menu.Root>
                  <Menu.Trigger
                    render={<Button variant="ghost" size="icon" aria-label="More input actions" />}
                  >
                    <ChevronDownIcon aria-hidden="true" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="top" align="end" sideOffset={8} className="z-50">
                      <Menu.Popup className="w-72 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                        <Menu.Item
                          disabled={!canInput}
                          onClick={() => {
                            onSubmit("follow_up");
                          }}
                          className="cursor-default rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50"
                        >
                          <span className="block font-medium">Follow up</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Wait until current work finishes.
                          </span>
                        </Menu.Item>
                        <Menu.Item
                          disabled={!canInput}
                          onClick={() => {
                            onSubmit("steer");
                          }}
                          className="cursor-default rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50"
                        >
                          <span className="block font-medium">Steer</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Deliver at Pi&apos;s next steering boundary.
                          </span>
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </>
            )}
          </div>
        </div>
      </form>
      <output className="mt-2 block min-h-4 max-h-[15dvh] overflow-y-auto px-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {pending ? "Waiting for Pi to confirm input… Acceptance does not mean completion." : notice}
      </output>
      {errors.length > 0 && (
        <div className="mt-3 max-h-[20dvh] space-y-2 overflow-y-auto rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm [overflow-wrap:anywhere]">
          {errors.map((error) => (
            <p key={error} role="alert" className="text-destructive">
              {error}
            </p>
          ))}
          {submissionError && (
            <p className="text-xs text-muted-foreground">
              Draft preserved. If acceptance is uncertain, review the conversation before sending
              again. Input is never retried automatically.
            </p>
          )}
          {snapshot.execution === "unknown" && (
            <p className="text-xs text-muted-foreground">
              Execution is unknown. Do not assume work completed or cancellation succeeded.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
