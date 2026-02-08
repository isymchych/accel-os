#!/usr/bin/env -S deno run --quiet --allow-run=git

type Mode = "diff" | "fingerprint" | "names";

const mode = parseMode(Deno.args);
const gitArgs = getGitArgs(mode);

const command = new Deno.Command("git", {
  args: ["--no-pager", ...gitArgs],
  stdin: "null",
  stdout: "piped",
  stderr: "piped",
  env: {
    LC_ALL: "C",
    GIT_PAGER: "cat",
  },
});

const { code, stdout, stderr } = await command.output();
const output = decode(stdout).trimEnd();
if (code === 0) {
  if (mode === "fingerprint") {
    console.log(await sha256Hex(output));
    Deno.exit(0);
  }

  if (output !== "") console.log(output);
  Deno.exit(0);
}

const errorText = decode(stderr).trim() || output || `git exited with status ${code}`;
if (/not a git repository/i.test(errorText)) {
  console.error(`ERR_NOT_REPO: ${errorText}`);
  Deno.exit(65);
}

console.error(`ERR_GIT: ${errorText}`);
Deno.exit(66);

function parseMode(args: string[]): Mode {
  if (args.length === 0) return "diff";
  if (args.length > 1) usage();

  switch (args[0]) {
    case "--fingerprint":
      return "fingerprint";
    case "--names":
      return "names";
    default:
      usage();
  }
}

function getGitArgs(mode: Mode): string[] {
  switch (mode) {
    case "fingerprint":
      return ["diff", "--staged", "--no-color", "--no-ext-diff"];
    case "names":
      return ["diff", "--staged", "--name-only", "--no-color", "--no-ext-diff"];
    case "diff":
      return ["diff", "--staged", "--no-color", "--no-ext-diff"];
  }
}

function usage(): never {
  console.error("ERR_USAGE: expected no args, --fingerprint, or --names");
  Deno.exit(64);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
