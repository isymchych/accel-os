#!/usr/bin/env -S deno run --quiet --allow-run=wl-copy

type ClipboardErrorReason =
  | "invalid-arguments"
  | "missing-input"
  | "missing-wl-copy"
  | "wayland-unavailable"
  | "wl-copy-failed";

class ClipboardError extends Error {
  reason: ClipboardErrorReason;
  action?: string;
  details?: string;

  constructor(reason: ClipboardErrorReason, message: string, options?: {
    action?: string;
    details?: string;
  }) {
    super(message);
    this.reason = reason;
    this.action = options?.action;
    this.details = options?.details;
  }
}

function formatClipboardError(error: ClipboardError): string {
  const segments = [`status=error reason=${error.reason}`];
  if (error.action) {
    segments.push(`action="${error.action}"`);
  }
  segments.push(`message="${error.message}"`);
  if (error.details) {
    segments.push(`details="${error.details}"`);
  }
  return segments.join(" ");
}

function parseTextArg(args: string[]): string | null {
  const flagIndex = args.indexOf("--text");
  if (flagIndex === -1) return null;
  if (flagIndex === args.length - 1) {
    throw new ClipboardError(
      "invalid-arguments",
      "--text flag requires a value.",
      { action: "Pass --text \"...\" or pipe stdin." },
    );
  }
  return args.slice(flagIndex + 1).join(" ");
}

async function readStdinText(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return "";
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

async function copyText(text: string): Promise<void> {
  try {
    const process = new Deno.Command("wl-copy", {
      stdin: "piped",
      stderr: "piped",
    }).spawn();
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(text));
    await writer.close();
    const status = await process.status;
    if (!status.success) {
      const stderr = process.stderr
        ? (await new Response(process.stderr).text()).trim()
        : "";
      const details = stderr || `exit_code=${status.code}`;
      if (
        stderr.includes("Failed to connect to a Wayland server") ||
        stderr.includes("WAYLAND_DISPLAY") ||
        stderr.includes("No such file or directory")
      ) {
        throw new ClipboardError(
          "wayland-unavailable",
          "Wayland clipboard is unavailable.",
          {
            action: "Check WAYLAND_DISPLAY and compositor session.",
            details,
          },
        );
      }
      throw new ClipboardError("wl-copy-failed", "wl-copy exited with failure.", {
        details,
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ClipboardError(
        "missing-wl-copy",
        "wl-copy is not installed or not in PATH.",
        { action: "Install wl-clipboard." },
      );
    }
    if (error instanceof ClipboardError) throw error;
    throw error;
  }
}

async function main() {
  const textArg = parseTextArg(Deno.args);
  if (textArg === null && Deno.stdin.isTerminal()) {
    throw new ClipboardError(
      "missing-input",
      "No text provided.",
      { action: "Pass --text \"...\" or pipe stdin." },
    );
  }
  const text = textArg ?? await readStdinText();
  if (text.length === 0) {
    throw new ClipboardError(
      "missing-input",
      "Input text is empty.",
      { action: "Pass non-empty --text value or non-empty stdin." },
    );
  }
  await copyText(text);
  console.log("Copied text to clipboard.");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof ClipboardError) {
      console.error(formatClipboardError(error));
      Deno.exit(1);
    }
    const message = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    console.error(
      `status=error reason=wl-copy-failed message="Unexpected error while copying text." details="${message}"`,
    );
    Deno.exit(1);
  }
}
