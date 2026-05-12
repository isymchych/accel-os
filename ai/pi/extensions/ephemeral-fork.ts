/**
 * Adds `/ephemeral-fork`, which opens a branch of the current session in a separate terminal
 * backed by a managed temporary session file.
 *
 * The extension owns only selection and launch flow: it lets the user choose a prior user
 * message, extracts the branch up to that point into a temp session, and starts `ai`
 * in a child terminal. Session-file lifecycle and cleanup stay centralized in the launcher
 * and shared ephemeral-session helpers.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  createEphemeralSessionFile,
  removeEphemeralSessionArtifacts,
} from "../lib/ephemeral-session.ts";
import { isRecord } from "../lib/guards.ts";

const execFileAsync = promisify(execFile);
const WINDOW_CLASS = "pi-ephemeral-fork";
const PREVIEW_LIMIT = 120;

type UserMessageChoice = {
  entry: SessionEntry & {
    type: "message";
    message: {
      role: "user";
      content: unknown;
    };
  };
  label: string;
};

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const type = item["type"];
    if (type !== "text") {
      continue;
    }

    const text = item["text"];
    if (typeof text !== "string") {
      continue;
    }

    parts.push(text);
  }
  return parts.join(" ");
}

function isUserMessageEntry(choice: SessionEntry): choice is UserMessageChoice["entry"] {
  return choice.type === "message" && choice.message.role === "user";
}

function buildChoices(entries: readonly SessionEntry[]): UserMessageChoice[] {
  const userMessages = entries.filter(isUserMessageEntry);
  return userMessages.map((entry, index) => {
    const preview = extractUserText(entry.message.content).replace(/\s+/g, " ").trim();
    const text = preview.length > 0 ? preview : "(empty user message)";
    return {
      entry,
      label: `${index + 1}. ${truncate(text, PREVIEW_LIMIT)}`,
    };
  });
}

async function launchEphemeralTerminal(cwd: string, ephemeralSessionFile: string): Promise<void> {
  const accelOs = process.env["ACCEL_OS"];
  if (accelOs === undefined || accelOs.length === 0) {
    throw new Error("ACCEL_OS is not set.");
  }

  const aiPath = join(accelOs, "ai", "pi", "ai.ts");

  await execFileAsync("xterm", [
    "run",
    "--cwd",
    cwd,
    "--class",
    WINDOW_CLASS,
    "--",
    process.execPath,
    aiPath,
    "ephemeral-session",
    ephemeralSessionFile,
  ]);
}

export default function ephemeralForkExtension(pi: ExtensionAPI): void {
  pi.registerCommand("ephemeral-fork", {
    description: "Open a temporary fork in a new terminal",
    handler: async (_args, ctx) => {
      try {
        await ctx.waitForIdle();

        const choices = buildChoices(ctx.sessionManager.getBranch());
        if (choices.length === 0) {
          ctx.ui.notify("No user messages available to fork from.", "warning");
          return;
        }

        const selectedLabel = await ctx.ui.select(
          "Fork before which user message?",
          choices.map((choice) => choice.label),
        );
        if (selectedLabel === undefined) {
          return;
        }

        const selectedChoice = choices.find((choice) => choice.label === selectedLabel);
        if (selectedChoice === undefined) {
          throw new Error("Selected fork target was not found.");
        }

        const ephemeralSession = await createEphemeralSessionFile({
          sessionManager: ctx.sessionManager,
          targetLeafId: selectedChoice.entry.parentId,
        });

        try {
          await launchEphemeralTerminal(ctx.cwd, ephemeralSession.sessionFile);
        } catch (error) {
          await removeEphemeralSessionArtifacts(ephemeralSession.sessionFile);
          throw error;
        }

        ctx.ui.notify("Opened ephemeral fork in a new terminal.", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
  });
}
