import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const NOTIFY_THRESHOLD_MS = 3_000;
const TITLE_LIMIT = 80;
const BODY_LIMIT = 160;

type MessageLike = {
  role?: string;
  content?: unknown;
};

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:o=unfocused:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notify(title: string, body: string): void {
  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
    return;
  }

  notifyOSC777(title, body);
}

function playNotificationSound(): void {
  const accelOs = process.env.ACCEL_OS;
  if (!accelOs) return;

  const soundPath = join(accelOs, "ai", "mixkit-correct-answer-tone-2870.wav");
  if (!existsSync(soundPath)) return;

  if (process.platform === "linux") {
    execFile("paplay", [soundPath], (error) => {
      if (!error) return;
      execFile("pw-play", [soundPath], () => {});
    });
  }
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function sanitizePreview(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[;\x07\x1b]/g, " ")
    .trim();
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function extractTextParts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const text = "text" in item && typeof item.text === "string"
      ? item.text
      : undefined;
    if (text && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts;
}

function findLastTextByRole(messages: MessageLike[], role: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== role) continue;

    const text = sanitizePreview(extractTextParts(message.content).join(" "));
    if (text.length > 0) return text;
  }
  return undefined;
}

function buildNotification(messages: MessageLike[], elapsedMs: number): {
  title: string;
  body: string;
} {
  const elapsed = formatElapsed(elapsedMs);
  const userPreview = findLastTextByRole(messages, "user");
  const assistantPreview = findLastTextByRole(messages, "assistant");

  const title = userPreview
    ? truncate(userPreview, TITLE_LIMIT)
    : "Pi reply ready";

  if (assistantPreview) {
    return {
      title,
      body: truncate(`${assistantPreview} · ${elapsed}`, BODY_LIMIT),
    };
  }

  return {
    title,
    body: `Ready for input · ${elapsed}`,
  };
}

export default function longResponseNotifyExtension(pi: ExtensionAPI) {
  let startedAt: number | undefined;

  pi.on("session_start", async () => {
    startedAt = undefined;
  });

  pi.on("agent_start", async () => {
    startedAt = Date.now();
  });

  pi.on("agent_end", async (event) => {
    if (startedAt === undefined) return;

    const elapsed = Date.now() - startedAt;
    startedAt = undefined;
    if (elapsed < NOTIFY_THRESHOLD_MS) return;

    const notification = buildNotification(event.messages, elapsed);
    notify(notification.title, notification.body);
    playNotificationSound();
  });
}
