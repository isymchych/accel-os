import { readFile } from "node:fs/promises";

import { getErrorMessage } from "@accel-os/shared/guards";

import { runGit, type GitCommandResult } from "../../lib/git_command.ts";
import {
  classifyGitFailure,
  formatGitError,
  printStructuredGitError,
} from "../../lib/git_error.ts";

const BODY_LINE_MAX = 99;

type CommitOptions = {
  messageFile?: string;
  noVerify: boolean;
};

class UsageError extends Error {}

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

export function parseCommitOptions(args: string[]): CommitOptions {
  const options: CommitOptions = { noVerify: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--no-verify") {
      options.noVerify = true;
      continue;
    }

    if (arg === "--message-file") {
      const filePath = args[index + 1];
      if (!filePath) throw new UsageError("missing value for --message-file");
      options.messageFile = filePath;
      index += 1;
      continue;
    }

    throw new UsageError(`unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function readInput(options: CommitOptions): Promise<string> {
  if (options.messageFile) {
    return await readFile(options.messageFile, "utf8");
  }

  process.stdin.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
}

export function buildCommitArgs(message: string, options: CommitOptions): string[] {
  const lines = message.split("\n");
  const subject = lines[0] ?? "";
  const body = lines.slice(2).join("\n").trimEnd();

  const args = ["commit"];
  if (options.noVerify) args.push("--no-verify");
  args.push("-m", subject);
  if (body) args.push("-m", body);
  return args;
}

async function commitMessage(message: string, options: CommitOptions): Promise<GitCommandResult> {
  const args = buildCommitArgs(message, options);
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
    const options = parseCommitOptions(process.argv.slice(2));
    const rawMessage = await readInput(options);
    const normalized = normalizeMessage(rawMessage);
    const result = await commitMessage(normalized, options);

    if (result.code === 0) {
      const sha = await readHeadSha();
      console.log(`OK ${sha}`);
      process.exit(0);
    }

    printStructuredGitError(classifyGitFailure(result.stdout, result.stderr));
    process.exit(3);
  } catch (error) {
    const message = getErrorMessage(error);
    const code =
      error instanceof UsageError
        ? "ERR_USAGE"
        : message.startsWith("empty commit")
          ? "ERR_MESSAGE_INVALID"
          : "ERR_INTERNAL";
    printStructuredGitError(formatGitError(code, message, ""));
    process.exit(code === "ERR_USAGE" || code === "ERR_MESSAGE_INVALID" ? 2 : 4);
  }
}
