#!/usr/bin/env -S deno run --quiet --allow-run=gh,git

type Mode = "dry-run" | "delete";

type Candidate = {
  branch: string;
  lastPush: string;
};

type Skipped = {
  branch: string;
  lastPush: string;
  reason: string;
};

type Args = {
  mainBranch: string;
  dryRun: boolean;
  confirmDelete: string;
};

type RefNode = {
  name: string;
  target: {
    committedDate?: string | null;
    pushedDate?: string | null;
  } | null;
};

type GraphQlResponse = {
  data?: {
    repository?: {
      refs?: {
        nodes?: RefNode[];
        pageInfo?: {
          hasNextPage?: boolean;
          endCursor?: string | null;
        };
      };
    };
  };
};

type PullRequest = {
  state?: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  headRepositoryOwner?: {
    login?: string;
  } | null;
};

const DELETE_CONFIRM_TOKEN = "DELETE_STALE_BRANCHES";
const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;

const GRAPHQL_QUERY = `
query($owner:String!, $name:String!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    refs(refPrefix:"refs/heads/", first:100, after:$cursor) {
      nodes {
        name
        target {
          ... on Commit {
            oid
            committedDate
            pushedDate
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`;

const SPR_PR_QUERY = `
query($owner:String!, $name:String!, $branch:String!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(headRefName:$branch, states:[OPEN, CLOSED, MERGED], first:100, after:$cursor) {
      nodes {
        state
        mergedAt
        closedAt
        headRepositoryOwner {
          login
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`;

function usage(): never {
  console.error(
    "Usage: prune-stale-branches.ts [--main <branch>] [--dry-run] [--confirm-delete <token>]",
  );
  console.error("");
  console.error("Deletes remote branches that are not ahead of <main> and whose last push is older");
  console.error("than 3 weeks. Always prints the full candidate list before deletion.");
  console.error("For spr/* branches, deletes when PR is closed/merged (no staleness check).");
  console.error(`Delete mode requires: --confirm-delete ${DELETE_CONFIRM_TOKEN}`);
  console.error('Requires gh auth and git remote "origin".');
  Deno.exit(0);
}

function parseArgs(argv: string[]): Args {
  let mainBranch = "main";
  let dryRun = false;
  let confirmDelete = "";

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--main":
        if (!argv[i + 1]) {
          console.error("Missing value for --main");
          Deno.exit(1);
        }
        mainBranch = argv[i + 1];
        i += 2;
        break;
      case "--dry-run":
        dryRun = true;
        i += 1;
        break;
      case "--confirm-delete":
        if (!argv[i + 1]) {
          console.error("Missing value for --confirm-delete");
          Deno.exit(1);
        }
        confirmDelete = argv[i + 1];
        i += 2;
        break;
      case "-h":
      case "--help":
        usage();
      default:
        console.error(`Unknown argument: ${arg}`);
        Deno.exit(1);
    }
  }

  return { mainBranch, dryRun, confirmDelete };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function run(
  command: string,
  args: string[],
  opts: { tolerateFailure?: boolean } = {},
): Promise<{ success: boolean; stdout: string; stderr: string; code: number }> {
  const result = await new Deno.Command(command, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = decode(result.stdout).trimEnd();
  const stderr = decode(result.stderr).trimEnd();
  if (!result.success && !opts.tolerateFailure) {
    if (stderr) console.error(stderr);
    else if (stdout) console.error(stdout);
    else console.error(`${command} exited with status ${result.code}`);
    Deno.exit(1);
  }

  return { success: result.success, stdout, stderr, code: result.code };
}

async function resolveRepo(): Promise<{ owner: string; name: string }> {
  const { stdout } = await run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const [owner, name] = stdout.split("/");
  if (!owner || !name) {
    console.error(`Unable to parse repo owner/name from: ${stdout}`);
    Deno.exit(1);
  }
  return { owner, name };
}

async function ensureMainBranchExists(mainBranch: string): Promise<void> {
  await run("git", ["fetch", "--prune", "origin", "--quiet"]);
  const check = await run(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${mainBranch}`],
    { tolerateFailure: true },
  );
  if (!check.success) {
    console.error(`Main branch not found on origin: ${mainBranch}`);
    Deno.exit(1);
  }
}

function parseDateToEpochMs(value: string): number | null {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return timestamp;
}

async function findSprSkipReason(owner: string, name: string, branch: string): Promise<string> {
  const prs: PullRequest[] = [];
  let cursor = "";

  while (true) {
    const ghArgs = [
      "api",
      "graphql",
      "-f",
      `query=${SPR_PR_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-f",
      `branch=${branch}`,
    ];
    if (cursor !== "") ghArgs.push("-f", `cursor=${cursor}`);

    const response = await run("gh", ghArgs, { tolerateFailure: true });
    if (!response.success) return "pr_lookup_failed";

    let parsed: {
      data?: {
        repository?: {
          pullRequests?: {
            nodes?: PullRequest[];
            pageInfo?: {
              hasNextPage?: boolean;
              endCursor?: string | null;
            };
          };
        };
      };
    };
    try {
      parsed = JSON.parse(response.stdout) as typeof parsed;
    } catch {
      return "pr_lookup_failed";
    }

    const pullRequests = parsed.data?.repository?.pullRequests;
    prs.push(...(pullRequests?.nodes ?? []));

    const hasNextPage = pullRequests?.pageInfo?.hasNextPage === true;
    const endCursor = pullRequests?.pageInfo?.endCursor ?? "";
    if (!hasNextPage || endCursor === "") break;
    cursor = endCursor;
  }

  const sameRepoOwnerPrs = prs.filter((pr) => (pr.headRepositoryOwner?.login ?? "") === owner);
  if (sameRepoOwnerPrs.length === 0) return "spr_no_pr";

  for (const pr of sameRepoOwnerPrs) {
    const state = pr.state ?? "";
    const mergedAt = pr.mergedAt ?? "";
    const closedAt = pr.closedAt ?? "";
    if (state === "OPEN" && mergedAt === "" && closedAt === "") return "spr_pr_open";
  }

  return "";
}

async function aheadCount(mainBranch: string, branch: string): Promise<number | null> {
  const rev = await run(
    "git",
    ["rev-list", "--left-right", "--count", `origin/${mainBranch}...origin/${branch}`],
    { tolerateFailure: true },
  );
  if (!rev.success) return null;
  const parts = rev.stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(ahead)) return null;
  return ahead;
}

async function fetchRefsPage(
  owner: string,
  name: string,
  cursor?: string,
): Promise<{ nodes: RefNode[]; hasNextPage: boolean; endCursor: string }> {
  const ghArgs = [
    "api",
    "graphql",
    "-f",
    `query=${GRAPHQL_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
  ];
  if (cursor && cursor !== "") {
    ghArgs.push("-f", `cursor=${cursor}`);
  }
  const response = await run("gh", ghArgs);

  let parsed: GraphQlResponse;
  try {
    parsed = JSON.parse(response.stdout) as GraphQlResponse;
  } catch {
    console.error("Failed to parse GraphQL response");
    Deno.exit(1);
  }

  const refs = parsed.data?.repository?.refs;
  return {
    nodes: refs?.nodes ?? [],
    hasNextPage: refs?.pageInfo?.hasNextPage === true,
    endCursor: refs?.pageInfo?.endCursor ?? "",
  };
}

function printCandidates(candidates: Candidate[]): void {
  if (candidates.length === 0) {
    console.log("No branches match prune criteria.");
    return;
  }

  console.log(`Candidates to delete (${candidates.length}):`);
  for (const candidate of candidates) {
    console.log(`Would delete: ${candidate.branch} (last push ${candidate.lastPush})`);
  }
}

function printSkipped(skipped: Skipped[]): void {
  if (skipped.length === 0) return;

  console.log(`Skipped branches (${skipped.length}):`);
  for (const item of skipped) {
    console.log(`Skipped: ${item.branch} (last push ${item.lastPush}, reason ${item.reason})`);
  }

  const counts = new Map<string, number>();
  for (const item of skipped) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));

  console.log("Skip reason counts:");
  for (const [reason, count] of ordered) {
    console.log(`${reason}: ${count}`);
  }
}

async function deleteBranches(candidates: Candidate[]): Promise<void> {
  for (const candidate of candidates) {
    await run("git", ["push", "origin", "--delete", candidate.branch]);
  }
}

async function main(): Promise<void> {
  const { mainBranch, dryRun, confirmDelete } = parseArgs(Deno.args);
  const mode: Mode = dryRun ? "dry-run" : "delete";
  const thresholdMs = Date.now() - THREE_WEEKS_MS;

  const { owner, name } = await resolveRepo();
  await ensureMainBranchExists(mainBranch);

  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];

  let cursor = "";
  while (true) {
    const page = await fetchRefsPage(owner, name, cursor);

    for (const node of page.nodes) {
      const branch = node.name;
      const lastPush = node.target?.pushedDate ?? node.target?.committedDate ?? "";
      if (!branch) continue;

      if (branch === mainBranch) {
        skipped.push({ branch, lastPush, reason: "main_branch" });
        continue;
      }

      if (branch.startsWith("spr/")) {
        const reason = await findSprSkipReason(owner, name, branch);
        if (reason !== "") {
          skipped.push({ branch, lastPush: lastPush || "unknown", reason });
          continue;
        }
        candidates.push({ branch, lastPush: lastPush || "unknown" });
      } else {
        if (!lastPush) continue;
        const lastPushMs = parseDateToEpochMs(lastPush);
        if (lastPushMs === null) {
          skipped.push({ branch, lastPush, reason: "invalid_last_push" });
          continue;
        }

        if (lastPushMs >= thresholdMs) {
          skipped.push({ branch, lastPush, reason: "too_recent" });
          continue;
        }

        const ahead = await aheadCount(mainBranch, branch);
        if (ahead === null) {
          skipped.push({ branch, lastPush, reason: "ahead_check_failed" });
          continue;
        }
        if (ahead !== 0) {
          skipped.push({ branch, lastPush, reason: "ahead_of_main" });
          continue;
        }

        candidates.push({ branch, lastPush });
      }
    }

    if (!page.hasNextPage) break;
    if (!page.endCursor) break;
    cursor = page.endCursor;
  }

  printCandidates(candidates);
  printSkipped(skipped);

  if (mode === "dry-run" || candidates.length === 0) return;

  if (confirmDelete !== DELETE_CONFIRM_TOKEN) {
    console.error("Refusing delete without explicit confirmation token.");
    console.error(`Re-run with: --confirm-delete ${DELETE_CONFIRM_TOKEN}`);
    Deno.exit(1);
  }

  await deleteBranches(candidates);
}

if (import.meta.main) {
  await main();
}
