import { GitBranchIcon, SendIcon, SquareIcon } from "lucide-react";
import { memo, useEffect, useState, type ReactElement, type RefObject } from "react";

import type {
  Prompt,
  SessionControls,
  SessionHistory,
  SessionSnapshot,
  TranscriptMessage,
} from "../desktop-api.ts";
import { Button } from "./components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";
import { Textarea } from "./components/ui/textarea.tsx";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Pi did not confirm this operation.";
}

function LongText({ text }: { text: string }): ReactElement {
  const style = "whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]";
  if (text.length <= 4_000) return <pre className={style}>{text}</pre>;
  return (
    <Collapsible>
      <pre className={style}>{text.slice(0, 1_000)}…</pre>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
        Show full content ({text.length.toLocaleString()} characters)
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className={style}>{text}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

const Message = memo(function Message({ message }: { message: TranscriptMessage }): ReactElement {
  return (
    <article
      aria-label={`${message.role} message`}
      className={`rounded-lg border border-border p-4 [content-visibility:auto] [contain-intrinsic-size:auto_120px] ${message.isError ? "text-destructive" : ""}`}
    >
      <h2 className="mb-2 text-sm font-semibold">{message.role}</h2>
      <LongText text={message.text} />
    </article>
  );
});

const Transcript = memo(function Transcript({
  messages,
}: {
  messages: TranscriptMessage[];
}): ReactElement {
  return (
    <>
      {messages
        .filter((message) => message.text.length > 0)
        .map((message, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- Pi message snapshots are append-only between explicit history replacements.
          <Message key={index} message={message} />
        ))}
    </>
  );
});

function ModelControls({
  controls,
  idle,
  sessionKey,
  change,
}: {
  controls: SessionControls | null;
  idle: boolean;
  sessionKey: string;
  change: (operation: () => Promise<void>) => Promise<void>;
}): ReactElement {
  if (!controls) return <p className="text-xs text-muted-foreground">Loading model controls…</p>;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <span id="model-label" className="text-xs text-muted-foreground">
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
                await window.pi.model(sessionKey, model.provider, model.id);
              });
          }}
        >
          <SelectTrigger aria-labelledby="model-label" className="max-w-80">
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
      <div className="space-y-1">
        <span id="thinking-label" className="text-xs text-muted-foreground">
          Thinking
        </span>
        <Select
          disabled={!idle}
          value={controls.thinkingLevel}
          onValueChange={(value) => {
            if (value)
              void change(async () => {
                await window.pi.thinking(sessionKey, value);
              });
          }}
        >
          <SelectTrigger aria-labelledby="thinking-label">
            <SelectValue placeholder="Thinking level" />
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
      <span className="text-xs text-muted-foreground">
        {controls.pendingMessageCount} queued inputs
      </span>
    </div>
  );
}

function RuntimeControls({
  snapshot,
  onFork,
  onNavigateText,
}: {
  snapshot: SessionSnapshot;
  onFork: (entryId: string) => void;
  onNavigateText: (key: string, text: string) => void;
}): ReactElement {
  const [controls, setControls] = useState<SessionControls | null>(null);
  const [history, setHistory] = useState<SessionHistory | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const { key, connection, execution } = snapshot;

  useEffect(() => {
    if (connection !== "connected") return undefined;
    let active = true;
    void Promise.all([window.pi.controls(key), window.pi.history(key)])
      .then(([next, tree]) => {
        if (!active) return;
        setControls(next);
        setHistory(tree);
        setEntry((current) =>
          tree.entries.some((item) => item.id === current) ? current : tree.leafId,
        );
      })
      .catch((error: unknown) => {
        if (active) setFeedback(errorText(error));
      });
    return (): void => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refresh at execution/submission boundaries, not on every streaming revision.
  }, [key, connection, execution, snapshot.notice]);

  async function change(operation: () => Promise<void>): Promise<void> {
    setPending(true);
    setFeedback(null);
    try {
      await operation();
      const [next, tree] = await Promise.all([window.pi.controls(key), window.pi.history(key)]);
      setControls(next);
      setHistory(tree);
    } catch (error) {
      setFeedback(errorText(error));
    }
    setPending(false);
  }
  const idle = connection === "connected" && execution === "idle" && !pending;
  return (
    <section aria-label="Session controls" className="space-y-3 border-b border-border py-4">
      <ModelControls controls={controls} idle={idle} sessionKey={key} change={change} />
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
          <GitBranchIcon aria-hidden="true" />
          History and branches
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            Navigate when idle. Fork copies persisted history through the selected entry without
            stopping the source. Unfinished output and runtime fork hooks are excluded.
          </p>
          <div className="flex flex-wrap gap-2">
            <Select
              value={entry}
              onValueChange={setEntry}
              disabled={(history?.entries.length ?? 0) === 0}
            >
              <SelectTrigger aria-label="History entry" className="max-w-full">
                <SelectValue placeholder="Choose history entry">
                  {history?.entries.find((item) => item.id === entry)?.label ??
                    "Choose history entry"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {history?.entries.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id === history.leafId ? "Current · " : ""}
                    {item.label} [{item.id} ← {item.parentId ?? "root"}]
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!idle || !entry}
              onClick={() => {
                if (entry)
                  void change(async () => {
                    const text = await window.pi.navigate(key, entry);
                    if (text !== undefined) onNavigateText(key, text);
                  });
              }}
            >
              Navigate
            </Button>
            <Button
              variant="outline"
              disabled={connection !== "connected" || !entry || pending}
              onClick={() => {
                if (entry) onFork(entry);
              }}
            >
              Fork conversation
            </Button>
            <Button
              variant="ghost"
              disabled={connection !== "connected" || pending}
              onClick={() => {
                void change(async () => {});
              }}
            >
              Refresh history
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {feedback && (
        <p role="alert" className="text-sm text-destructive">
          {feedback}
        </p>
      )}
    </section>
  );
}

interface ComposerProps {
  snapshot: SessionSnapshot;
  message: string;
  pending: boolean;
  feedback: string | null;
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
}: ComposerProps): ReactElement {
  const [stopError, setStopError] = useState<string | null>(null);
  const ready = snapshot.connection === "connected";
  const busy = snapshot.execution === "running" || snapshot.execution === "stopping";
  const canInput =
    ready &&
    !pending &&
    snapshot.execution !== "unknown" &&
    snapshot.execution !== "stopping" &&
    message.trim().length > 0;
  const submissionError = feedback && !feedback.startsWith("Input:") ? feedback : null;
  const visibleError = stopError ?? submissionError ?? snapshot.error;
  return (
    <section aria-label="Direct agent">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit("prompt");
        }}
        className="border-t border-border pt-4"
      >
        <label htmlFor="message" className="mb-2 block text-sm font-medium">
          Message
        </label>
        <Textarea
          ref={composerRef}
          id="message"
          className="min-h-28 resize-y"
          maxLength={100_000}
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
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!canInput || busy} type="submit">
            <SendIcon aria-hidden="true" />
            {pending ? "Sending…" : "Send"}
          </Button>
          <Button
            disabled={!canInput}
            type="button"
            variant="outline"
            onClick={() => {
              onSubmit("follow_up");
            }}
          >
            Follow up
          </Button>
          <Button
            disabled={!canInput}
            type="button"
            variant="outline"
            onClick={() => {
              onSubmit("steer");
            }}
          >
            Steer
          </Button>
          <Button
            disabled={!ready || !busy || snapshot.execution === "stopping"}
            type="button"
            variant="outline"
            onClick={() => {
              setStopError(null);
              void window.pi.stop(snapshot.key).catch((error: unknown) => {
                setStopError(errorText(error));
              });
            }}
          >
            <SquareIcon aria-hidden="true" />
            {snapshot.execution === "stopping" ? "Stopping…" : "Stop"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Follow up waits until current work finishes; steering is delivered at Pi&apos;s next
          steering boundary.
        </p>
      </form>
      {visibleError && (
        <p role="alert" className="mt-4 text-destructive">
          {visibleError}
        </p>
      )}
      {feedback?.startsWith("Input:") && <output className="mt-3 block text-sm">{feedback}</output>}
      {snapshot.notice && <output className="mt-3 block text-sm">{snapshot.notice}</output>}
      <p className="mt-6 text-xs text-muted-foreground">
        Pi tools run on your host without a sandbox. Unsupported dialogs are cancelled. Refreshing
        keeps work running; quitting stops all sessions.
      </p>
    </section>
  );
}

export function SessionView(
  props: ComposerProps & {
    onFork: (entryId: string) => void;
    onNavigateText: (key: string, text: string) => void;
  },
): ReactElement {
  const { snapshot, onFork } = props;
  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h2 className="text-xl font-semibold">{snapshot.name || "New conversation"}</h2>
        <p className="mt-2 break-all text-sm text-muted-foreground">{snapshot.cwd}</p>
        <output className="mt-2 block text-sm">
          Connection: {snapshot.connection} · Execution: {snapshot.execution}
        </output>
        {snapshot.activity && <p className="mt-2 text-sm">{snapshot.activity}</p>}
      </header>
      <RuntimeControls snapshot={snapshot} onFork={onFork} onNavigateText={props.onNavigateText} />
      <section aria-label="Conversation" className="space-y-4 py-5">
        <Transcript messages={snapshot.messages} />
        {snapshot.streaming && (
          <article aria-label="Streaming response" className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-sm font-semibold">assistant</h2>
            <LongText text={snapshot.streaming} />
          </article>
        )}
        {snapshot.tools.length > 0 && (
          <section aria-label="Tool activity" className="space-y-2">
            {snapshot.tools.map((tool) => (
              <Collapsible key={tool.id} className="rounded-lg border border-border p-3">
                <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                  {tool.name} · {tool.state}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  <h3 className="text-xs font-semibold">Arguments</h3>
                  <LongText text={tool.arguments} />
                  <h3 className="text-xs font-semibold">Result</h3>
                  <LongText text={tool.output || "Waiting for output…"} />
                </CollapsibleContent>
              </Collapsible>
            ))}
          </section>
        )}
      </section>
      <SessionComposer {...props} />
    </div>
  );
}
