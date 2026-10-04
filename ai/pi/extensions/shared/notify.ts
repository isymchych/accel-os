/**
 * Sends focus-aware Kitty desktop notifications without starting a separate
 * audio player. Kitty suppresses both the popup and named sound when focused.
 */
import { randomUUID } from "node:crypto";

export const NOTIFICATION_TITLE_LIMIT = 80;
export const NOTIFICATION_BODY_LIMIT = 160;

/** Name resolved from the user-installed Freedesktop sound theme. */
const PI_NOTIFICATION_SOUND = "mb-pi-complete";

export interface KittyNotification {
  id: string;
  title: string;
  body: string;
}

interface NotificationOutput {
  isTTY?: boolean;
  write: (text: string) => unknown;
}

export function createNotificationId(kind: "response" | "questionnaire" | "summary"): string {
  return `pi-${kind}-${randomUUID()}`;
}

export function sanitizeNotificationText(text: string): string {
  return text
    .replaceAll(";", " ")
    .replaceAll("\u0007", " ")
    .replaceAll("\u001b", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateNotificationText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** Builds a complete two-part OSC 99 notification with base64 text payloads. */
export function createKittyNotificationEscapeSequence(notification: KittyNotification): string {
  const title = truncateNotificationText(
    sanitizeNotificationText(notification.title),
    NOTIFICATION_TITLE_LIMIT,
  );
  const body = truncateNotificationText(
    sanitizeNotificationText(notification.body),
    NOTIFICATION_BODY_LIMIT,
  );
  const sound = encode(PI_NOTIFICATION_SOUND);

  return (
    `\x1b]99;i=${notification.id}:o=unfocused:s=${sound}:e=1:d=0;${encode(title)}\x1b\\` +
    `\x1b]99;i=${notification.id}:p=body:e=1;${encode(body)}\x1b\\`
  );
}

/** Returns whether a Kitty notification was written. */
export function sendUnfocusedKittyNotification(
  notification: KittyNotification,
  environment: NodeJS.ProcessEnv = process.env,
  output: NotificationOutput = process.stdout,
): boolean {
  if (!output.isTTY || !environment["KITTY_WINDOW_ID"]) {
    return false;
  }

  try {
    output.write(createKittyNotificationEscapeSequence(notification));
    return true;
  } catch {
    return false;
  }
}
