import { Menu } from "@base-ui/react/menu";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { ArrowUpIcon, ChevronDownIcon, SquareIcon } from "lucide-react";
import type { ReactElement, RefObject } from "react";

import type { SessionSnapshot } from "../../contracts/index.ts";
import { useAppModel } from "../app/app-provider.tsx";
import { Button } from "../components/ui/button.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { requestFeedback } from "../transport/errors.ts";

export function SessionComposer({
  snapshot,
  composerRef,
  onExitComposer,
  modelControls,
}: {
  snapshot: SessionSnapshot;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onExitComposer: () => void;
  modelControls: ReactElement;
}): ReactElement {
  const { sessions, composers } = useAppModel();
  const composer = composers(snapshot.key);
  const { message, pending, feedback } = useAtomValue(composer.state);
  const edit = useAtomSet(composer.edit);
  const onSubmit = useAtomSet(composer.submit);
  const [stopResult, stop] = useAtom(sessions.stop(snapshot.key));
  const stopError = requestFeedback(stopResult, true);
  const stopPending = stopResult.waiting;
  const ready = snapshot.connection === "connected";
  const stopping = stopPending || snapshot.execution === "stopping";
  const busy = snapshot.execution === "running" || stopping;
  const canInput =
    ready && !pending && !stopping && snapshot.execution !== "unknown" && message.trim().length > 0;
  const submissionError = feedback?.message;
  const errors = [...new Set([submissionError, stopError, snapshot.error].filter(Boolean))];
  // Acceptance is not completion. Execution and queue length live in the header.
  // Keep extension notices, not duplicate input-acceptance receipts.
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
            edit({ message: event.currentTarget.value });
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
                    stop(undefined);
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
