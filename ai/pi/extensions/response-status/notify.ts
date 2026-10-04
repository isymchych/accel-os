import { basename } from "node:path";

import {
  createNotificationId,
  NOTIFICATION_BODY_LIMIT,
  NOTIFICATION_TITLE_LIMIT,
  sanitizeNotificationText,
  sendUnfocusedKittyNotification,
  truncateNotificationText,
  type KittyNotification,
} from "../shared/notify.ts";

const NOTIFY_THRESHOLD_MS = 3_000;

type TextPart = {
  text: string;
};

type MessageLike = {
  role?: string;
  content?: unknown;
};

export type SummaryNotificationKind = "compaction" | "branch";

function isTextPart(value: unknown): value is TextPart {
  return (
    typeof value === "object" && value !== null && "text" in value && typeof value.text === "string"
  );
}

function extractTextParts(content: unknown): string[] {
  if (typeof content === "string") {
    return content.trim().length > 0 ? [content] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isTextPart(item)) {
      continue;
    }

    if (item.text.trim().length > 0) {
      parts.push(item.text);
    }
  }

  return parts;
}

function findLastTextByRole(messages: readonly MessageLike[], role: string): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== role) {
      continue;
    }

    const text = sanitizeNotificationText(extractTextParts(message.content).join(" "));
    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
}

export function createLongResponseNotification(
  messages: readonly MessageLike[],
  summary: string,
): {
  title: string;
  body: string;
} {
  const userPreview = findLastTextByRole(messages, "user");
  const assistantPreview = findLastTextByRole(messages, "assistant");

  const title =
    userPreview !== undefined && userPreview.length > 0
      ? truncateNotificationText(userPreview, NOTIFICATION_TITLE_LIMIT)
      : "Pi reply ready";

  if (assistantPreview !== undefined && assistantPreview.length > 0) {
    return {
      title,
      body: truncateNotificationText(`${assistantPreview} · ${summary}`, NOTIFICATION_BODY_LIMIT),
    };
  }

  return {
    title,
    body: truncateNotificationText(`Ready for input · ${summary}`, NOTIFICATION_BODY_LIMIT),
  };
}

export function notifyForLongResponse({
  elapsedMs,
  messages,
  summary,
  notify = sendUnfocusedKittyNotification,
}: {
  elapsedMs: number;
  messages: readonly MessageLike[];
  summary: string;
  notify?: (notification: KittyNotification) => void;
}): void {
  if (elapsedMs < NOTIFY_THRESHOLD_MS) {
    return;
  }

  const notification = createLongResponseNotification(messages, summary);
  notify({
    id: createNotificationId("response"),
    ...notification,
  });
}

/** Sends an unfocused-only notification after a user-requested summarization succeeds. */
export function notifyForSummary(
  kind: SummaryNotificationKind,
  cwd: string,
  notify: (notification: KittyNotification) => void = sendUnfocusedKittyNotification,
): void {
  notify({
    id: createNotificationId("summary"),
    title: "Pi summarization complete",
    body: `${basename(cwd)} · ${kind === "compaction" ? "Context compacted" : "Branch summary ready"}`,
  });
}
