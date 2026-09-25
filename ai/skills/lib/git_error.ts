export type ClassifiedGitError = {
  code: string;
  summary: string;
  details: string[];
};

export function classifyGitFailure(stdout: string, stderr: string): ClassifiedGitError {
  const combined = `${stderr}\n${stdout}`.trim();
  const normalized = combined.toLowerCase();

  if (normalized.includes("not a git repository")) {
    return formatGitError("ERR_GIT_NOT_REPO", "not inside a git repository", stderr, stdout);
  }
  if (
    normalized.includes("nothing to commit") ||
    normalized.includes("no changes added to commit") ||
    normalized.includes("nothing added to commit")
  ) {
    return formatGitError("ERR_GIT_NOTHING_STAGED", "nothing is staged for commit", stderr, stdout);
  }
  if (
    normalized.includes("author identity unknown") ||
    normalized.includes("unable to auto-detect email address") ||
    normalized.includes("please tell me who you are")
  ) {
    return formatGitError(
      "ERR_GIT_IDENTITY",
      "git user.name or user.email is not configured",
      stderr,
      stdout,
    );
  }
  if (
    normalized.includes("pre-commit") ||
    normalized.includes("hook declined") ||
    normalized.includes("hook failed")
  ) {
    return formatGitError("ERR_GIT_HOOK_PRE_COMMIT", "pre-commit hook failed", stderr, stdout);
  }
  if (normalized.includes("commit-msg")) {
    return formatGitError("ERR_GIT_HOOK_COMMIT_MSG", "commit-msg hook failed", stderr, stdout);
  }
  if (
    normalized.includes("merge") ||
    normalized.includes("rebase") ||
    normalized.includes("cherry-pick")
  ) {
    return formatGitError(
      "ERR_GIT_STATE",
      "git repository state prevents committing",
      stderr,
      stdout,
    );
  }
  return formatGitError("ERR_GIT_COMMIT", "git commit failed", stderr, stdout);
}

export function formatGitError(
  code: string,
  summary: string,
  stderr: string,
  stdout = "",
): ClassifiedGitError {
  return {
    code,
    summary,
    details: sanitizeGitErrorDetails(stderr, stdout),
  };
}

export function sanitizeGitErrorDetails(stderr: string, stdout = ""): string[] {
  const output = [
    stderr.trim() === "" ? "" : `stderr:\n${stderr}`,
    stdout.trim() === "" ? "" : `stdout:\n${stdout}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (output === "") return [];

  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export function printStructuredGitError(error: ClassifiedGitError): void {
  console.error(error.code);
  console.error(error.summary);
  for (const detail of error.details) console.error(detail);
}
