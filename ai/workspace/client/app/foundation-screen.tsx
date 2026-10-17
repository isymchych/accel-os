import { Send } from "@lucide/solid";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

import { api } from "../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

type Feedback = { kind: "success"; message: string } | { kind: "error"; message: string };

const defaultMessage = "Verify the workspace connection.";
const connectionErrorMessage = "The connection check could not be completed. Try again.";

export function FoundationScreen(): JSX.Element {
  const [message, setMessage] = createSignal(defaultMessage);
  const [feedback, setFeedback] = createSignal<Feedback | null>(null);
  const [isPending, setIsPending] = createSignal(false);

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void submitDiagnostic();
  }

  async function submitDiagnostic(): Promise<void> {
    setFeedback(null);
    setIsPending(true);

    try {
      const response = await api.api.diagnostic.$post({ json: { message: message() } });
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
    <main class="mx-auto flex min-h-dvh w-full max-w-2xl items-center px-5 py-10 sm:px-8">
      <section
        aria-labelledby="workspace-title"
        class="w-full rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <p class="text-sm font-medium text-muted-foreground">AI workspace</p>
        <h1
          class="mt-2 text-3xl font-semibold tracking-tight text-card-foreground"
          id="workspace-title"
        >
          Local workspace foundation
        </h1>
        <p class="mt-3 max-w-prose text-base leading-7 text-muted-foreground">
          Verify browser-to-server communication before the first product slice.
        </p>

        <form class="mt-8 border-t border-border pt-6" onSubmit={handleSubmit}>
          <fieldset class="space-y-5">
            <legend class="text-lg font-semibold text-card-foreground">Connection check</legend>
            <p class="text-sm leading-6 text-muted-foreground">
              Send a message to verify the browser can reach the local server.
            </p>
            <div class="space-y-2">
              <label class="text-sm font-medium text-card-foreground" for="diagnostic-message">
                Message
              </label>
              <Input
                aria-describedby={feedback() === null ? undefined : feedbackId}
                id="diagnostic-message"
                maxlength={200}
                onInput={(event) => setMessage(event.currentTarget.value)}
                readonly={isPending()}
                required
                value={message()}
              />
            </div>
            <Button class="w-full sm:w-auto" disabled={isPending()} type="submit">
              <Send aria-hidden="true" class="size-4 shrink-0" />
              {isPending() ? "Checking connection..." : "Send test message"}
            </Button>
          </fieldset>

          <Show when={feedback()}>
            {(result) => (
              <p
                class={`mt-5 break-words rounded-lg border px-4 py-3 text-sm ${
                  result().kind === "error"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border bg-muted text-foreground"
                }`}
                id={feedbackId}
                role={result().kind === "error" ? "alert" : "status"}
              >
                {result().message}
              </p>
            )}
          </Show>
        </form>
      </section>
    </main>
  );
}
