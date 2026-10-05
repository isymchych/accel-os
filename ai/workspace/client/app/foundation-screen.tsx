import { useState } from "react";
import type { FormEvent, ReactElement } from "react";

import { api } from "../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

type Feedback = { kind: "success"; message: string } | { kind: "error"; message: string };

const defaultMessage = "Verify the workspace connection.";
const connectionErrorMessage = "The connection check could not be completed. Try again.";

export function FoundationScreen(): ReactElement {
  const [message, setMessage] = useState(defaultMessage);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPending, setIsPending] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    void submitDiagnostic(event);
  }

  async function submitDiagnostic(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFeedback(null);
    setIsPending(true);

    try {
      const response = await api.api.diagnostic.$post({ json: { message } });
      if (!response.ok) {
        setFeedback({
          kind: "error",
          message: connectionErrorMessage,
        });
        return;
      }

      const { echo } = await response.json();
      setFeedback({ kind: "success", message: `Server response: ${echo}` });
    } catch {
      setFeedback({
        kind: "error",
        message: connectionErrorMessage,
      });
    } finally {
      setIsPending(false);
    }
  }

  const feedbackId = "connection-check-feedback";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-5 py-10 sm:px-8">
      <section
        aria-labelledby="workspace-title"
        className="w-full rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <p className="text-sm font-medium text-muted-foreground">AI workspace</p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-tight text-card-foreground"
          id="workspace-title"
        >
          Local workspace foundation
        </h1>
        <p className="mt-3 max-w-prose text-base leading-7 text-muted-foreground">
          Verify browser-to-server communication before the first product slice.
        </p>

        <form className="mt-8 border-t border-border pt-6" onSubmit={handleSubmit}>
          <fieldset className="space-y-5">
            <legend className="text-lg font-semibold text-card-foreground">Connection check</legend>
            <p className="text-sm leading-6 text-muted-foreground">
              Send a message to verify the browser can reach the local server.
            </p>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-card-foreground"
                htmlFor="diagnostic-message"
              >
                Message
              </label>
              <Input
                aria-describedby={feedback === null ? undefined : feedbackId}
                id="diagnostic-message"
                maxLength={200}
                onChange={(event) => setMessage(event.target.value)}
                readOnly={isPending}
                required
                value={message}
              />
            </div>
            <Button className="w-full sm:w-auto" disabled={isPending} type="submit">
              {isPending ? "Checking connection..." : "Send test message"}
            </Button>
          </fieldset>

          {feedback !== null ? (
            <p
              className={`mt-5 break-words rounded-lg border px-4 py-3 text-sm ${
                feedback.kind === "error"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-foreground"
              }`}
              id={feedbackId}
              role={feedback.kind === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
