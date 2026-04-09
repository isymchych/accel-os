#!/usr/bin/env -S deno run --quiet --allow-run=git --allow-read

import { classifyGitFailure, formatGitError, printStructuredGitError } from "../../lib/git_error.ts";
import { runGit } from "../../lib/git_command.ts";

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

async function commitMessage(message: string) {
  const lines = message.split("\n");
  const subject = lines[0] ?? "";
  const body = lines.slice(2).join("\n").trimEnd();

  const args = ["commit", "-m", subject];
  if (body) args.push("-m", body);
  return await runGit(args);
}

async function readHeadSha(): Promise<string> {
  const result = await runGit(["rev-parse", "HEAD"]);
  if (result.code !== 0) throw new Error("failed to read commit sha after successful commit");
  const sha = result.stdout.trim();
  if (!sha) throw new Error("git rev-parse returned empty commit sha");
  return sha;
}

if (import.meta.main) {
  try {
    const rawMessage = await readInput(Deno.args);
    const normalized = normalizeMessage(rawMessage);
    const result = await commitMessage(normalized);

    if (result.code === 0) {
      const sha = await readHeadSha();
      console.log(`OK ${sha}`);
      Deno.exit(0);
    }

    printStructuredGitError(classifyGitFailure(result.stdout, result.stderr));
    Deno.exit(3);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith("empty commit") || message.startsWith("missing value for --message-file")
      ? "ERR_MESSAGE_INVALID"
      : "ERR_INTERNAL";
    printStructuredGitError(formatGitError(code, message, ""));
    Deno.exit(code === "ERR_MESSAGE_INVALID" ? 2 : 4);
  }
}
