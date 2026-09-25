import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync as chmod,
  mkdtempSync as makeTempDir,
  rmSync as removeDir,
  writeFileSync as writeFile,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatGitError } from "../../lib/git_error.ts";

const applyScript = new URL("./apply_commit.ts", import.meta.url);

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitRaw(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function run(script: URL, cwd: string, args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script.pathname, ...args], {
    cwd,
    encoding: "utf8",
    input,
  });
}

function createRepository(): string {
  const cwd = makeTempDir(join(tmpdir(), "commit-helper-"));
  git(cwd, "init", "--quiet");
  git(cwd, "config", "user.name", "Commit Test");
  git(cwd, "config", "user.email", "commit-test@example.com");
  return cwd;
}

function commitFile(cwd: string, filename: string, contents: string, message: string): string {
  writeFile(join(cwd, filename), contents);
  git(cwd, "add", filename);
  git(cwd, "commit", "--quiet", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function commitBody(cwd: string): string {
  const content = gitRaw(cwd, "cat-file", "commit", "HEAD");
  return content.slice(content.indexOf("\n\n") + 2);
}

test("apply_commit preserves exact input in verbatim mode", () => {
  const cwd = createRepository();

  try {
    writeFile(join(cwd, "new.txt"), "new\n");
    git(cwd, "add", "new.txt");
    const message = `feat: preserve message\n\n  indented detail\n${"x".repeat(110)}\n`;

    const result = run(applyScript, cwd, ["create", "--verbatim"], message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^OK [0-9a-f]{40}\n$/);
    assert.equal(commitBody(cwd), message);
  } finally {
    removeDir(cwd, { recursive: true, force: true });
  }
});

test("apply_commit normalizes separators and wraps paragraphs and bullets", () => {
  const cwd = createRepository();

  try {
    writeFile(join(cwd, "formatted.txt"), "formatted\n");
    git(cwd, "add", "formatted.txt");
    const paragraph = "a".repeat(100);
    const bullet = "b".repeat(100);
    const message = `\n  feat: format message  \n   \n${paragraph}\n\n- ${bullet}\n\n`;

    const result = run(applyScript, cwd, ["create"], message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      commitBody(cwd),
      [
        "feat: format message",
        "",
        "a".repeat(99),
        "a",
        "",
        `- ${"b".repeat(97)}`,
        `  ${"b".repeat(3)}`,
        "",
      ].join("\n"),
    );
  } finally {
    removeDir(cwd, { recursive: true, force: true });
  }
});

test("apply_commit preserves staged changes when amending only a message", () => {
  const cwd = createRepository();

  try {
    const expectedHead = commitFile(cwd, "committed.txt", "committed\n", "feat: old message");
    writeFile(join(cwd, "staged.txt"), "staged\n");
    git(cwd, "add", "staged.txt");

    const result = run(
      applyScript,
      cwd,
      ["amend", "--expected-head", expectedHead],
      "feat: new message\n\nExplain the updated outcome.\n",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(cwd, "diff", "--cached", "--name-only"), "staged.txt");
    assert.equal(git(cwd, "show", "--format=", "--name-only", "HEAD"), "committed.txt");
    assert.equal(commitBody(cwd), "feat: new message\n\nExplain the updated outcome.\n");
  } finally {
    removeDir(cwd, { recursive: true, force: true });
  }
});

test("apply_commit rejects stale or published amends unless explicitly allowed", () => {
  const cwd = createRepository();
  const remote = makeTempDir(join(tmpdir(), "commit-helper-remote-"));

  try {
    const expectedHead = commitFile(cwd, "first.txt", "first\n", "feat: first");
    commitFile(cwd, "second.txt", "second\n", "feat: second");
    const stale = run(
      applyScript,
      cwd,
      ["amend", "--expected-head", expectedHead],
      "feat: stale\n\nExplain the stale outcome.\n",
    );
    assert.equal(stale.status, 67);
    assert.match(stale.stderr, /^ERR_HEAD_CHANGED\n/);

    git(remote, "init", "--bare", "--quiet");
    git(cwd, "remote", "add", "origin", remote);
    git(cwd, "push", "--quiet", "-u", "origin", "HEAD:main");
    const currentHead = git(cwd, "rev-parse", "HEAD");

    const published = run(
      applyScript,
      cwd,
      ["amend", "--expected-head", currentHead],
      "feat: published\n\nExplain the published outcome.\n",
    );
    assert.equal(published.status, 68);
    assert.match(published.stderr, /^ERR_PUBLISHED_COMMIT\n/);

    const allowed = run(
      applyScript,
      cwd,
      ["amend", "--expected-head", currentHead, "--allow-published"],
      "feat: published\n\nExplain the published outcome.\n",
    );
    assert.equal(allowed.status, 0, allowed.stderr);
  } finally {
    removeDir(cwd, { recursive: true, force: true });
    removeDir(remote, { recursive: true, force: true });
  }
});

test("apply_commit honors hooks unless --no-verify is requested", () => {
  const cwd = createRepository();

  try {
    writeFile(join(cwd, "hooked.txt"), "hooked\n");
    git(cwd, "add", "hooked.txt");
    const hook = join(cwd, ".git", "hooks", "pre-commit");
    writeFile(
      hook,
      [
        "#!/bin/sh",
        "echo 'pre-commit hook failed' >&2",
        "echo 'backend typecheck failed: error TS2322' >&2",
        "i=1",
        'while [ "$i" -le 12 ]; do',
        '  echo "hook output $i" >&2',
        "  i=$((i + 1))",
        "done",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmod(hook, 0o755);

    const blocked = run(
      applyScript,
      cwd,
      ["create"],
      "feat: blocked\n\nExercise the configured hook.\n",
    );
    assert.equal(blocked.status, 3);
    assert.match(blocked.stderr, /^ERR_GIT_HOOK_PRE_COMMIT\n/);
    assert.match(blocked.stderr, /stderr:[\s\S]*backend typecheck failed: error TS2322/);
    assert.match(blocked.stderr, /hook output 12/);

    const allowed = run(
      applyScript,
      cwd,
      ["create", "--no-verify"],
      "feat: allowed\n\nBypass the configured hook.\n",
    );
    assert.equal(allowed.status, 0, allowed.stderr);
  } finally {
    removeDir(cwd, { recursive: true, force: true });
  }
});

test("formatGitError preserves stderr and stdout without truncation", () => {
  const error = formatGitError(
    "ERR_GIT_COMMIT",
    "git commit failed",
    ["first diagnostic", ...Array.from({ length: 12 }, (_, index) => `stderr ${index + 1}`)].join(
      "\n",
    ),
    "stdout diagnostic",
  );

  assert.deepEqual(error.details, [
    "stderr:",
    "first diagnostic",
    ...Array.from({ length: 12 }, (_, index) => `stderr ${index + 1}`),
    "stdout:",
    "stdout diagnostic",
  ]);
});

test("apply_commit rejects subject-only messages unless explicitly allowed", () => {
  const cwd = createRepository();

  try {
    writeFile(join(cwd, "subject.txt"), "subject\n");
    git(cwd, "add", "subject.txt");

    const rejected = run(applyScript, cwd, ["create"], "feat: subject only\n");
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /^ERR_MESSAGE_INVALID\n/);
    assert.match(rejected.stderr, /--allow-subject-only/);
    assert.equal(git(cwd, "status", "--short"), "A  subject.txt");

    const allowed = run(
      applyScript,
      cwd,
      ["create", "--allow-subject-only"],
      "feat: subject only\n",
    );
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(commitBody(cwd), "feat: subject only\n");
  } finally {
    removeDir(cwd, { recursive: true, force: true });
  }
});

test("apply_commit rejects an empty subject in verbatim mode", () => {
  const cwd = createRepository();

  try {
    writeFile(join(cwd, "invalid.txt"), "invalid\n");
    git(cwd, "add", "invalid.txt");

    const result = run(applyScript, cwd, ["create", "--verbatim"], "\n\nBody only.\n");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^ERR_MESSAGE_INVALID\nempty commit subject\n$/);
    assert.equal(git(cwd, "status", "--short"), "A  invalid.txt");
  } finally {
    removeDir(cwd, { recursive: true, force: true });
  }
});
