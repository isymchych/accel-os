import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const NOTIFY_THRESHOLD_MS = 3_000;
const TITLE_LIMIT = 80;
const BODY_LIMIT = 160;

type TextPart = {
  text: string;
};

type MessageLike = {
  role?: string;
  content?: unknown;
};

function isTextPart(value: unknown): value is TextPart {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:o=unfocused:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notify(title: string, body: string): void {
  if (process.stdout.isTTY !== true) {
    return;
  }

  if ((process.env["KITTY_WINDOW_ID"] ?? "").length > 0) {
    notifyOSC99(title, body);
    return;
  }

  notifyOSC777(title, body);
}

function playNotificationSound(): void {
  if (process.stdout.isTTY !== true) {
    return;
  }

  const accelOs = process.env["ACCEL_OS"];
  if (accelOs === undefined || accelOs.length === 0) {
    return;
  }

  const soundPath = join(accelOs, "ai", "mixkit-correct-answer-tone-2870.wav");
  if (!existsSync(soundPath)) {
    return;
  }

  if (process.platform === "linux") {
    execFile("paplay", [soundPath], (error) => {
      if (!error) {
        return;
      }

      execFile("pw-play", [soundPath], () => undefined);
    });
  }
}

function sanitizePreview(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replaceAll(";", " ")
    .replaceAll("\u0007", " ")
    .replaceAll("\u001b", " ")
    .trim();
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
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

    const text = sanitizePreview(extractTextParts(message.content).join(" "));
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
      ? truncate(userPreview, TITLE_LIMIT)
      : "Pi reply ready";

  if (assistantPreview !== undefined && assistantPreview.length > 0) {
    return {
      title,
      body: truncate(`${assistantPreview} · ${summary}`, BODY_LIMIT),
    };
  }

  return {
    title,
    body: truncate(`Ready for input · ${summary}`, BODY_LIMIT),
  };
}

export function notifyForLongResponse({
  elapsedMs,
  messages,
  summary,
}: {
  elapsedMs: number;
  messages: readonly MessageLike[];
  summary: string;
}): void {
  if (elapsedMs < NOTIFY_THRESHOLD_MS) {
    return;
  }

  const notification = createLongResponseNotification(messages, summary);
  notify(notification.title, notification.body);
  playNotificationSound();
}