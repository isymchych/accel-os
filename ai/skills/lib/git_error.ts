const DETAIL_LINE_MAX = 10;
const DETAIL_CHAR_MAX = 1500;

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
    return formatGitError("ERR_GIT_IDENTITY", "git user.name or user.email is not configured", stderr, stdout);
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
    return formatGitError("ERR_GIT_STATE", "git repository state prevents committing", stderr, stdout);
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
    details: sanitizeGitErrorDetails(stderr || stdout),
  };
}

export function sanitizeGitErrorDetails(text: string): string[] {
  if (!text.trim()) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const limitedLines = lines.slice(-DETAIL_LINE_MAX);
  const details: string[] = [];
  let charsUsed = 0;

  for (const line of limitedLines) {
    if (charsUsed >= DETAIL_CHAR_MAX) break;
    const remaining = DETAIL_CHAR_MAX - charsUsed;
    if (line.length <= remaining) {
      details.push(line);
      charsUsed += line.length + 1;
      continue;
    }
    details.push(`${line.slice(0, Math.max(0, remaining - 1))}…`);
    break;
  }

  return details;
}

export function printStructuredGitError(error: ClassifiedGitError): void {
  console.error(error.code);
  console.error(error.summary);
  for (const detail of error.details) console.error(detail);
}
