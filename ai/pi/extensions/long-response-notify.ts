/**
 * Sends a desktop/terminal notification when Pi takes longer than a few seconds to finish a response.
 *
 * It measures each agent run, skips short replies, builds a sanitized preview from the latest user
 * and assistant messages, emits a terminal notification, and plays a local sound when available.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const NOTIFY_THRESHOLD_MS = 3_000;
const TITLE_LIMIT = 80;
const BODY_LIMIT = 160;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = MS_PER_SECOND * SECONDS_PER_MINUTE;

type TextPart = {
  text: string;
};

function isTextPart(value: unknown): value is TextPart {
  return (
    typeof value === "object" && value !== null && "text" in value && typeof value.text === "string"
  );
}

interface MessageLike {
  role?: string;
  content?: unknown;
}

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:o=unfocused:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notify(title: string, body: string): void {
  if ((process.env["KITTY_WINDOW_ID"] ?? "").length > 0) {
    notifyOSC99(title, body);
    return;
  }

  notifyOSC777(title, body);
}

function playNotificationSound(): void {
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

function formatElapsed(ms: number): string {
  if (ms < MINUTE_MS) {
    return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}m ${seconds}s`;
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

function buildNotification(
  messages: readonly MessageLike[],
  elapsedMs: number,
): {
  title: string;
  body: string;
} {
  const elapsed = formatElapsed(elapsedMs);
  const userPreview = findLastTextByRole(messages, "user");
  const assistantPreview = findLastTextByRole(messages, "assistant");

  const title =
    userPreview !== undefined && userPreview.length > 0
      ? truncate(userPreview, TITLE_LIMIT)
      : "Pi reply ready";

  if (assistantPreview !== undefined && assistantPreview.length > 0) {
    return {
      body: truncate(`${assistantPreview} · ${elapsed}`, BODY_LIMIT),
      title,
    };
  }

  return {
    body: `Ready for input · ${elapsed}`,
    title,
  };
}

export default function longResponseNotifyExtension(pi: ExtensionAPI): void {
  let startedAt: number | undefined;

  pi.on("session_start", () => {
    startedAt = undefined;
  });

  pi.on("agent_start", () => {
    startedAt = Date.now();
  });

  pi.on("agent_end", (event) => {
    if (startedAt === undefined) {
      return;
    }

    const elapsed = Date.now() - startedAt;
    startedAt = undefined;
    if (elapsed < NOTIFY_THRESHOLD_MS) {
      return;
    }

    const notification = buildNotification(event.messages, elapsed);
    notify(notification.title, notification.body);
    playNotificationSound();
  });
}
