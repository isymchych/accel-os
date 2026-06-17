/**
 * Browser preview command for Pi assistant responses.
 *
 * The extension keeps Markdown rendering outside Pi by delegating to the
 * repository-owned `mb-preview` executable on PATH. Pi owns only conversation
 * selection and passes the selected assistant response to `mb-preview` on stdin,
 * with the current working directory as the base for relative local assets.
 */

import { spawn } from "node:child_process";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

const usage = "Usage: /preview";

export interface AssistantPreviewResponse {
  readonly index: number;
  readonly title: string;
  readonly markdown: string;
  readonly preview: string;
}

export interface PreviewRequest {
  readonly title: string;
  readonly cwd: string;
}

export interface PreviewChild {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type PreviewSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] },
) => PreviewChild;

function isAssistantMessage(
  message: SessionMessageEntry["message"],
): message is Extract<SessionMessageEntry["message"], { role: "assistant" }> {
  return message.role === "assistant";
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function normalizePreviewLine(markdown: string): string {
  const firstLine = markdown
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();
  const preview = (firstLine ?? "Assistant response").replace(/^#+\s*/, "").replaceAll(/\s+/g, " ");
  return preview.length <= 100 ? preview : `${preview.slice(0, 99)}…`;
}

export function collectAssistantPreviewResponses(
  entries: readonly SessionEntry[],
): AssistantPreviewResponse[] {
  const responses: AssistantPreviewResponse[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || !isAssistantMessage(entry.message)) {
      continue;
    }

    const textBlocks = Array.isArray(entry.message.content)
      ? entry.message.content.filter(isTextContent)
      : [];
    const markdown = textBlocks
      .map((block) => block.text)
      .filter((text) => text.trim().length > 0)
      .join("\n\n");

    if (markdown.length === 0) {
      continue;
    }

    const index = responses.length + 1;
    responses.push({
      index,
      title: `Pi response ${index}`,
      markdown,
      preview: normalizePreviewLine(markdown),
    });
  }

  return responses;
}

export function buildMbPreviewArgs(request: PreviewRequest): string[] {
  return ["--open", "--title", request.title, "--base-dir", request.cwd];
}

export async function runMbPreview(
  markdown: string,
  request: PreviewRequest,
  spawnPreview: PreviewSpawn = spawn,
): Promise<void> {
  const child = spawnPreview("mb-preview", buildMbPreviewArgs(request), {
    cwd: request.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: unknown) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk: unknown) => {
    stderr += String(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `exited with ${signal ?? `code ${code}`}`;
      reject(new Error(`mb-preview failed: ${detail}`));
    });

    child.stdin.end(markdown);
  });
}

async function pickAssistantResponse(
  ctx: ExtensionCommandContext,
  responses: readonly AssistantPreviewResponse[],
): Promise<AssistantPreviewResponse | null> {
  if (responses.length === 1) {
    return responses[0] ?? null;
  }

  const items: SelectItem[] = responses.map((response, index) => ({
    value: String(index),
    label: `Response ${response.index}`,
    description: response.preview,
  }));

  const selectedIndex = await ctx.ui.custom<number | null>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(
      new Text(theme.fg("accent", theme.bold("Select response to preview")), 1, 0),
    );

    const selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text): string => theme.fg("accent", text),
      selectedText: (text): string => theme.fg("accent", text),
      description: (text): string => theme.fg("muted", text),
      scrollInfo: (text): string => theme.fg("dim", text),
      noMatch: (text): string => theme.fg("warning", text),
    });
    selectList.setSelectedIndex(items.length - 1);
    selectList.onSelect = (item): void => done(Number.parseInt(item.value, 10));
    selectList.onCancel = (): void => done(null);

    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return {
      render(width: number): string[] {
        return container.render(width);
      },
      invalidate(): void {
        container.invalidate();
      },
      handleInput(data: string): void {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });

  return selectedIndex === null ? null : (responses[selectedIndex] ?? null);
}

async function runPreviewCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  if (args.trim().length > 0) {
    ctx.ui.notify(usage, "error");
    return;
  }

  await ctx.waitForIdle();

  const responses = collectAssistantPreviewResponses(ctx.sessionManager.getBranch());
  if (responses.length === 0) {
    ctx.ui.notify("No assistant responses found in the current branch.", "warning");
    return;
  }

  if (responses.length > 1 && ctx.mode !== "tui") {
    ctx.ui.notify("/preview response picker requires interactive TUI mode.", "error");
    return;
  }

  const selected = await pickAssistantResponse(ctx, responses);
  if (selected === null) {
    return;
  }

  try {
    await runMbPreview(selected.markdown, { title: selected.title, cwd: ctx.cwd });
    ctx.ui.notify("Opened preview in browser.", "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(message, "error");
  }
}

export default function previewExtension(pi: ExtensionAPI): void {
  pi.registerCommand("preview", {
    description: "Pick an assistant response and open a rendered Markdown browser preview",
    handler: runPreviewCommand,
  });
}
