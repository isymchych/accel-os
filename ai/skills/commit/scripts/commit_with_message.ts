#!/usr/bin/env -S deno run --quiet --allow-run=git --allow-read

const BODY_LINE_MAX = 99;

export function normalizeMessage(message: string): string {
  const lines = message.split(/\r?\n/);
  if (lines.length === 0) throw new Error("empty commit message");

  const subject = lines[0]?.trimEnd() ?? "";
  if (!subject) throw new Error("empty commit subject");

  const bodySource = lines.length > 1 && lines[1] === "" ? lines.slice(2) : lines.slice(1);
  const bodyLines: string[] = [];
  for (const line of bodySource) bodyLines.push(...wrapLine(line.trimEnd()));

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();

  const normalized = [subject, "", ...bodyLines].join("\n");
  return `${normalized}\n`;
}

function wrapLine(line: string): string[] {
  if (line === "") return [""];

  if (line.startsWith("- ")) {
    const marker = "- ";
    const wrapped = wrapText(line.slice(2).trim(), BODY_LINE_MAX - marker.length);
    if (wrapped.length === 0) return ["-"];
    return [`${marker}${wrapped[0]}`, ...wrapped.slice(1).map((part) => `  ${part}`)];
  }

  const leadingSpaces = line.length - line.trimStart().length;
  const indent = " ".repeat(leadingSpaces);
  const wrapped = wrapText(line.trim(), BODY_LINE_MAX - leadingSpaces);
  if (wrapped.length === 0) return [indent];
  return wrapped.map((part) => `${indent}${part}`);
}

function wrapText(text: string, width: number): string[] {
  if (text === "") return [];
  if (width < 1) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";

  for (const word of words) {
    if (current === "") {
      if (word.length <= width) {
        current = word;
      } else {
        out.push(...splitLongToken(word, width));
      }
      continue;
    }

    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }

    out.push(current);
    if (word.length <= width) {
      current = word;
    } else {
      const pieces = splitLongToken(word, width);
      out.push(...pieces.slice(0, -1));
      current = pieces.at(-1) ?? "";
    }
  }

  if (current !== "") out.push(current);
  return out;
}

function splitLongToken(token: string, width: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < token.length; i += width) chunks.push(token.slice(i, i + width));
  return chunks;
}

async function readInput(args: string[]): Promise<string> {
  const fileFlagIndex = args.indexOf("--message-file");
  if (fileFlagIndex >= 0) {
    const filePath = args[fileFlagIndex + 1];
    if (!filePath) throw new Error("missing value for --message-file");
    return await Deno.readTextFile(filePath);
  }

  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of Deno.stdin.readable) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return text;
}

async function commitMessage(message: string): Promise<number> {
  const lines = message.split("\n");
  const subject = lines[0] ?? "";
  const body = lines.slice(2).join("\n").trimEnd();

  const cmd = ["git", "commit", "-m", subject];
  if (body) cmd.push("-m", body);

  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  return code;
}

if (import.meta.main) {
  try {
    const rawMessage = await readInput(Deno.args);
    const normalized = normalizeMessage(rawMessage);
    const code = await commitMessage(normalized);
    Deno.exit(code);
  } catch (error) {
    console.error(`commit message error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(2);
  }
}
