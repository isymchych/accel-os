import type { JSX } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";
import { Value } from "typebox/value";

import { ReloadStatusSchema, type ReloadStatus } from "../../../contracts/reload.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../../ui/button.tsx";

export function ReloadControl(props: { preserveDraft: () => boolean }): JSX.Element {
  const [status, setStatus] = createSignal<ReloadStatus | null>(null);
  const [notice, setNotice] = createSignal("");
  const [disconnected, setDisconnected] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  let retryId: string | undefined;

  function accept(value: unknown): void {
    if (!Value.Check(ReloadStatusSchema, value)) throw new Error("Invalid reload status.");
    setStatus(value);
    if (retryId !== undefined && value.operationId === retryId) {
      retryId = undefined;
      setNotice("");
    }
    if (
      value.servingVersion !== null &&
      value.servingVersion !== __BUILD_ID__ &&
      value.phase !== "activating"
    ) {
      if (props.preserveDraft()) {
        window.location.reload();
      } else {
        setNotice(
          "The updated UI is ready, but this draft could not be saved. Keep this tab open and copy your message before refreshing.",
        );
      }
    }
  }

  onSettled(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(): Promise<void> {
      try {
        const response = await api.api.reload.$get(
          {},
          {
            init: { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]) },
          },
        );
        if (!response.ok) throw new Error("Reload status unavailable.");
        if (!abort.signal.aborted) {
          accept(await response.json());
          setDisconnected(false);
        }
      } catch {
        if (!abort.signal.aborted) setDisconnected(true);
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(() => {
            void poll();
          }, 1_000);
      }
    }
    void poll();
    return (): void => {
      abort.abort();
      clearTimeout(timer);
    };
  });

  async function reload(): Promise<void> {
    if (submitting()) return;
    setNotice("");
    if (!props.preserveDraft()) {
      setNotice(
        "Check & Reload was not started because this draft could not be saved. Copy your message before refreshing.",
      );
      return;
    }
    setSubmitting(true);
    const requestId = retryId ?? crypto.randomUUID();
    try {
      const response = await api.api.reload.$post(
        { json: { requestId } },
        {
          init: { signal: AbortSignal.timeout(10_000) },
        },
      );
      if (response.status === 409) {
        accept(await response.json());
        retryId = undefined;
        return;
      }
      if (!response.ok) throw new Error("Reload request failed.");
      accept(await response.json());
      retryId = undefined;
    } catch {
      retryId = requestId;
      setNotice(
        "The reload request could not be confirmed. Reconnecting; retrying this request will not start it twice.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function busy(): boolean {
    const phase = status()?.phase;
    return submitting() || phase === "checking" || phase === "building" || phase === "activating";
  }

  return (
    <section aria-label="Application updates" class="mt-8 space-y-3 border-t border-border pt-6">
      <h2 class="text-lg font-semibold text-card-foreground">Application updates</h2>
      <p class="text-sm leading-6 text-muted-foreground">
        Check source, build, and activate UI and API changes. Your message is preserved in this tab.
        Launcher changes require a full restart.
      </p>
      <Button
        disabled={busy()}
        onClick={() => {
          void reload();
        }}
        type="button"
      >
        {busy() ? "Checking & reloading..." : "Check & Reload"}
      </Button>
      <p
        aria-live="polite"
        aria-label="Reload status"
        class="break-words text-sm text-muted-foreground"
      >
        {notice() ||
          (disconnected()
            ? "Disconnected from the API. Reconnecting; the launcher is independent."
            : status()?.message || "Connecting to the application supervisor...")}
      </p>
    </section>
  );
}
