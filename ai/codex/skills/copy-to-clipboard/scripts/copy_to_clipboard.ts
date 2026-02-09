#!/usr/bin/env -S deno run --quiet --allow-run=wl-copy

function parseTextArg(args: string[]): string | null {
  const flagIndex = args.indexOf("--text");
  if (flagIndex === -1) return null;
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
      if (stderr.includes("Failed to connect to a Wayland server")) {
        throw new Error(
          "Wayland clipboard unavailable. Check WAYLAND_DISPLAY and compositor session.",
        );
      }
      throw new Error(stderr ? `wl-copy failed: ${stderr}` : "wl-copy failed");
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("wl-copy is not installed. Install the wl-clipboard package.");
    }
    throw error;
  }
}

async function main() {
  const textArg = parseTextArg(Deno.args);
  const text = textArg ?? await readStdinText();
  if (text.length === 0) {
    throw new Error("No text provided. Pass --text \"...\" or pipe stdin.");
  }
  await copyText(text);
  console.log("Copied text to clipboard.");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
