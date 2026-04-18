/**
 * OpenAI Codex status formatting helpers.
 *
 * This module owns the pure presentation logic for usage windows so the overlay can stay thin
 * while tests cover the exact line layout.
 */
export interface LimitWindow {
  usedPercent: number;
  windowSeconds?: number;
  resetsAt?: number;
}

export interface StatusSnapshot {
  planType?: string;
  accountEmail?: string;
  accountPlan?: string;
  allowed?: boolean;
  limitReached?: boolean;
  primary?: LimitWindow;
  secondary?: LimitWindow;
  fetchedAt: number;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK_THRESHOLD = 24;
const DAYS_PER_WEEK_THRESHOLD = 7.5;
const DAYS_PER_MONTH_THRESHOLD = 31;
export const PROGRESS_BAR_WIDTH = 20;

export function describeWindow(seconds?: number): string {
  if (seconds === undefined || seconds <= 0) {
    return "limit";
  }

  const hours = seconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR);
  const days = hours / HOURS_PER_DAY;
  if (hours <= HOURS_PER_WEEK_THRESHOLD) {
    return `${Math.max(1, Math.round(hours))}h limit`;
  }
  if (days <= DAYS_PER_WEEK_THRESHOLD) {
    return "weekly limit";
  }
  if (days <= DAYS_PER_MONTH_THRESHOLD) {
    return "monthly limit";
  }
  return "usage limit";
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(
    (totalSeconds % (SECONDS_PER_MINUTE * MINUTES_PER_HOUR)) / SECONDS_PER_MINUTE,
  );
  const days = Math.floor(hours / HOURS_PER_DAY);

  if (days > 0) {
    const remHours = hours % HOURS_PER_DAY;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatReset(timestamp: number | undefined, now = Date.now()): string {
  if (timestamp === undefined) {
    return "reset unknown";
  }

  const diff = timestamp - now;
  if (diff <= 0) {
    return "resets now";
  }
  return `resets in ${formatDuration(diff)}`;
}

export function formatWindow(window: LimitWindow | undefined, now = Date.now()): string {
  if (!window) {
    return "unavailable";
  }

  const left = Math.max(0, 100 - window.usedPercent);
  return `${left}% left (${formatReset(window.resetsAt, now)})`;
}

export function formatPlan(plan?: string): string | undefined {
  if (plan === undefined || plan.length === 0) {
    return undefined;
  }
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function renderProgressBar(percentLeft: number, width = PROGRESS_BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(100, percentLeft));
  const filled = Math.round((clamped / 100) * width);
  return `[${"█".repeat(filled)}${" ".repeat(width - filled)}]`;
}

export function renderWindowLine(
  label: string,
  window: LimitWindow | undefined,
  labelWidth: number,
  now = Date.now(),
): string {
  const paddedLabel = label.padEnd(labelWidth, " ");
  if (!window) {
    return `${paddedLabel}: ${renderProgressBar(0)} unavailable`;
  }

  const left = Math.max(0, 100 - window.usedPercent);
  return `${paddedLabel}: ${renderProgressBar(left)} ${formatWindow(window, now)}`;
}

export function renderStatusLines(snapshot: StatusSnapshot, now = Date.now()): string[] {
  const header =
    snapshot.planType === undefined || snapshot.planType.length === 0
      ? "OpenAI Codex"
      : `OpenAI Codex (${snapshot.planType})`;
  const statusBits: string[] = [];
  if (typeof snapshot.allowed === "boolean") {
    statusBits.push(snapshot.allowed ? "allowed" : "blocked");
  }
  if (snapshot.limitReached === true) {
    statusBits.push("limit reached");
  }

  const primaryLabel = describeWindow(snapshot.primary?.windowSeconds);
  const secondaryLabel = describeWindow(snapshot.secondary?.windowSeconds);
  const labelWidth = Math.max(primaryLabel.length, secondaryLabel.length);

  const lines = [
    header,
    renderWindowLine(primaryLabel, snapshot.primary, labelWidth, now),
    renderWindowLine(secondaryLabel, snapshot.secondary, labelWidth, now),
  ];

  const formattedPlan = formatPlan(snapshot.accountPlan ?? snapshot.planType);
  if (snapshot.accountEmail !== undefined && snapshot.accountEmail.length > 0) {
    const account =
      formattedPlan === undefined
        ? snapshot.accountEmail
        : `${snapshot.accountEmail} (${formattedPlan})`;
    lines.splice(1, 0, `Account: ${account}`);
  }

  if (statusBits.length > 0) {
    lines.splice(1, 0, `Status: ${statusBits.join(" · ")}`);
  }

  return lines;
}
