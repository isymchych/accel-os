import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import type { SessionSnapshot } from "../../contracts/desktop.ts";
import { Button } from "../ui/button.tsx";

function savedDraft(): string {
  try {
    return sessionStorage.getItem("pi-composer") ?? "";
  } catch {
    return "";
  }
}

function SessionHeader({ snapshot }: { snapshot: SessionSnapshot | null }): ReactElement {
  return (
    <header className="border-b border-border pb-5">
      <h1 className="text-2xl font-semibold">Pi workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Local Electron foundation · your existing Pi configuration
      </p>
      <p className="mt-3 break-all text-sm">{snapshot?.cwd ?? "Opening working directory…"}</p>
      <p className="mt-2 text-sm" role="status">
        Connection: {snapshot?.connection ?? "starting"} · Execution:{" "}
        {snapshot?.execution ?? "unknown"}
      </p>
      {snapshot?.activity && <p className="mt-2 text-sm">{snapshot.activity}</p>}
    </header>
  );
}

function Transcript({ snapshot }: { snapshot: SessionSnapshot | null }): ReactElement {
  return (
    <section aria-label="Conversation" className="space-y-5 py-6">
      {snapshot?.messages
        .filter((item) => item.text.length > 0)
        .map((item, index) => (
          <article aria-label={`${item.role} message`} key={index}>
            <h2 className="mb-2 text-sm font-semibold">{item.role}</h2>
            <pre
              className={`whitespace-pre-wrap break-words font-sans ${item.isError ? "text-destructive" : ""}`}
            >
              {item.text}
            </pre>
          </article>
        ))}
      {snapshot?.streaming && (
        <article aria-label="Streaming response">
          <h2 className="mb-2 text-sm font-semibold">assistant</h2>
          <pre className="whitespace-pre-wrap break-words font-sans">{snapshot.streaming}</pre>
        </article>
      )}
    </section>
  );
}

export function FoundationScreen(): ReactElement {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [message, setMessage] = useState(savedDraft);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const receive = (next: SessionSnapshot): void => {
      if (active)
        setSnapshot((current) => (!current || next.revision >= current.revision ? next : current));
    };
    const unsubscribe = window.pi.subscribe(receive);
    void window.pi
      .snapshot()
      .then(receive)
      .catch(() => {
        if (active) setFeedback("Could not connect to the desktop process. Reopen the app.");
      });
    return (): void => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("pi-composer", message);
    } catch {
      /* Keep the in-memory draft if browser storage is unavailable. */
    }
  }, [message]);

  async function submit(): Promise<void> {
    setPending(true);
    setFeedback(null);
    try {
      await window.pi.prompt({ message });
      setMessage("");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Could not submit input. Your draft is preserved.",
      );
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  const ready = snapshot?.connection === "connected";
  const busy = snapshot?.execution === "running" || snapshot?.execution === "stopping";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <SessionHeader snapshot={snapshot} />
      <Transcript snapshot={snapshot} />

      <form onSubmit={handleSubmit}>
        <label className="mb-2 block text-sm font-medium" htmlFor="message">
          Message
        </label>
        <textarea
          className="min-h-28 w-full resize-y rounded-sm border border-input bg-card p-3"
          id="message"
          maxLength={100_000}
          onChange={(event) => {
            setMessage(event.currentTarget.value);
          }}
          readOnly={pending}
          required
          value={message}
        />
        <div className="mt-3 flex gap-3">
          <Button disabled={!ready || busy || pending || message.trim().length === 0} type="submit">
            {pending ? "Sending…" : "Send"}
          </Button>
          <Button
            disabled={!ready || !busy || snapshot.execution === "stopping"}
            onClick={() => {
              void window.pi.stop().catch(() => {
                setFeedback("Pi has not confirmed cancellation.");
              });
            }}
            type="button"
          >
            {snapshot?.execution === "stopping" ? "Stopping…" : "Stop"}
          </Button>
        </div>
      </form>

      {(feedback ?? snapshot?.error) && (
        <p className="mt-4 text-destructive" role="alert">
          {feedback ?? snapshot?.error}
        </p>
      )}
      {snapshot?.notice && (
        <p className="mt-4" role="status">
          {snapshot.notice}
        </p>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        Pi tools run on your host without a sandbox. Terminal-only extensions and graphical dialogs
        are not yet supported. Refreshing this view keeps Pi running; quitting the app stops it.
      </p>
    </main>
  );
}
