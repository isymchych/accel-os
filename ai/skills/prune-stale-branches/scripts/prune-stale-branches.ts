import { parseJsonWithSchema } from "@accel-os/shared/json";
import { runCommand } from "@accel-os/shared/process";
import { Type, type Static } from "typebox";

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

const nullableStringSchema = Type.Union([Type.String(), Type.Null()]);

const pageInfoSchema = Type.Object({
  hasNextPage: Type.Boolean(),
  endCursor: nullableStringSchema,
});

const refNodeSchema = Type.Object({
  name: Type.String(),
  target: Type.Union([
    Type.Object({
      committedDate: Type.Optional(nullableStringSchema),
      pushedDate: Type.Optional(nullableStringSchema),
    }),
    Type.Null(),
  ]),
});

const refsResponseSchema = Type.Object({
  data: Type.Object({
    repository: Type.Object({
      refs: Type.Object({
        nodes: Type.Array(refNodeSchema),
        pageInfo: pageInfoSchema,
      }),
    }),
  }),
});

const pullRequestSchema = Type.Object({
  state: Type.String(),
  mergedAt: nullableStringSchema,
  closedAt: nullableStringSchema,
  headRepositoryOwner: Type.Union([
    Type.Object({
      login: Type.String(),
    }),
    Type.Null(),
  ]),
});

const pullRequestsResponseSchema = Type.Object({
  data: Type.Object({
    repository: Type.Object({
      pullRequests: Type.Object({
        nodes: Type.Array(pullRequestSchema),
        pageInfo: pageInfoSchema,
      }),
    }),
  }),
});

type RefNode = Static<typeof refNodeSchema>;
type PullRequest = Static<typeof pullRequestSchema>;

type RefPage = {
  nodes: RefNode[];
  hasNextPage: boolean;
  endCursor: string;
};

type PullRequestPage = {
  nodes: PullRequest[];
  hasNextPage: boolean;
  endCursor: string;
};

type BranchDecision =
  | { kind: "candidate"; candidate: Candidate }
  | { kind: "skip"; skipped: Skipped }
  | { kind: "ignore" };

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
  console.error(
    "Deletes remote branches that are not ahead of <main> and whose last push is older",
  );
  console.error("than 3 weeks. Always prints the full candidate list before deletion.");
  console.error("For spr/* branches, deletes when PR is closed/merged (no staleness check).");
  console.error(`Delete mode requires: --confirm-delete ${DELETE_CONFIRM_TOKEN}`);
  console.error('Requires gh auth and git remote "origin".');
  process.exit(0);
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
        const mainBranchValue = argv[i + 1];
        if (!mainBranchValue) {
          console.error("Missing value for --main");
          process.exit(1);
        }
        mainBranch = mainBranchValue;
        i += 2;
        break;
      case "--dry-run":
        dryRun = true;
        i += 1;
        break;
      case "--confirm-delete":
        const confirmDeleteValue = argv[i + 1];
        if (!confirmDeleteValue) {
          console.error("Missing value for --confirm-delete");
          process.exit(1);
        }
        confirmDelete = confirmDeleteValue;
        i += 2;
        break;
      case "-h":
      case "--help":
        usage();
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return { mainBranch, dryRun, confirmDelete };
}

async function run(
  command: string,
  args: string[],
  opts: { tolerateFailure?: boolean } = {},
): Promise<{ success: boolean; stdout: string; stderr: string; code: number }> {
  const result = await runCommand(command, args);
  const { stdout, stderr } = result;
  if (!result.success && !opts.tolerateFailure) {
    if (stderr) console.error(stderr);
    else if (stdout) console.error(stdout);
    else console.error(`${command} exited with status ${result.code}`);
    process.exit(1);
  }

  return { success: result.success, stdout, stderr, code: result.code };
}

async function resolveRepo(): Promise<{ owner: string; name: string }> {
  const { stdout } = await run("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
  const [owner, name] = stdout.split("/");
  if (!owner || !name) {
    console.error(`Unable to parse repo owner/name from: ${stdout}`);
    process.exit(1);
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
    process.exit(1);
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
    const ghArgs = buildSprPrQueryArgs(owner, name, branch, cursor);

    const response = await run("gh", ghArgs, { tolerateFailure: true });
    if (!response.success) return "pr_lookup_failed";

    const page = parsePullRequestPage(response.stdout);
    if (page === null) return "pr_lookup_failed";

    prs.push(...page.nodes);
    if (!page.hasNextPage || page.endCursor === "") break;
    cursor = page.endCursor;
  }

  const sameRepoOwnerPrs = prs.filter((pr) => (pr.headRepositoryOwner?.login ?? "") === owner);
  if (sameRepoOwnerPrs.length === 0) return "spr_no_pr";

  if (sameRepoOwnerPrs.some(isOpenPullRequest)) return "spr_pr_open";

  return "";
}

function buildSprPrQueryArgs(
  owner: string,
  name: string,
  branch: string,
  cursor: string,
): string[] {
  const args = [
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
  if (cursor !== "") args.push("-f", `cursor=${cursor}`);
  return args;
}

function isOpenPullRequest(pr: PullRequest): boolean {
  return (pr.state ?? "") === "OPEN" && (pr.mergedAt ?? "") === "" && (pr.closedAt ?? "") === "";
}

function parsePullRequestPage(text: string): PullRequestPage | null {
  try {
    const response = parseJsonWithSchema(
      text,
      pullRequestsResponseSchema,
      "GitHub pull requests response",
    );
    const pullRequests = response.data.repository.pullRequests;
    return {
      nodes: pullRequests.nodes,
      hasNextPage: pullRequests.pageInfo.hasNextPage,
      endCursor: pullRequests.pageInfo.endCursor ?? "",
    };
  } catch {
    return null;
  }
}

function parseGraphQlResponse(text: string): RefPage | null {
  try {
    const response = parseJsonWithSchema(text, refsResponseSchema, "GitHub refs response");
    const refs = response.data.repository.refs;
    return {
      nodes: refs.nodes,
      hasNextPage: refs.pageInfo.hasNextPage,
      endCursor: refs.pageInfo.endCursor ?? "",
    };
  } catch {
    return null;
  }
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

  const parsed = parseGraphQlResponse(response.stdout);
  if (parsed === null) {
    console.error("Failed to parse GraphQL response");
    process.exit(1);
  }

  return parsed;
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

async function collectBranchDecision(
  node: RefNode,
  context: { owner: string; name: string; mainBranch: string; thresholdMs: number },
): Promise<BranchDecision> {
  const branch = node.name;
  const lastPush = node.target?.pushedDate ?? node.target?.committedDate ?? "";
  if (!branch) return { kind: "ignore" };

  if (branch === context.mainBranch) {
    return { kind: "skip", skipped: { branch, lastPush, reason: "main_branch" } };
  }

  if (branch.startsWith("spr/")) {
    const reason = await findSprSkipReason(context.owner, context.name, branch);
    if (reason !== "") {
      return { kind: "skip", skipped: { branch, lastPush: lastPush || "unknown", reason } };
    }
    return { kind: "candidate", candidate: { branch, lastPush: lastPush || "unknown" } };
  }

  return await collectRegularBranchDecision(
    branch,
    lastPush,
    context.mainBranch,
    context.thresholdMs,
  );
}

async function collectRegularBranchDecision(
  branch: string,
  lastPush: string,
  mainBranch: string,
  thresholdMs: number,
): Promise<BranchDecision> {
  if (!lastPush) return { kind: "ignore" };

  const lastPushMs = parseDateToEpochMs(lastPush);
  if (lastPushMs === null)
    return { kind: "skip", skipped: { branch, lastPush, reason: "invalid_last_push" } };
  if (lastPushMs >= thresholdMs)
    return { kind: "skip", skipped: { branch, lastPush, reason: "too_recent" } };

  const ahead = await aheadCount(mainBranch, branch);
  if (ahead === null)
    return { kind: "skip", skipped: { branch, lastPush, reason: "ahead_check_failed" } };
  if (ahead !== 0) return { kind: "skip", skipped: { branch, lastPush, reason: "ahead_of_main" } };

  return { kind: "candidate", candidate: { branch, lastPush } };
}

async function main(): Promise<void> {
  const { mainBranch, dryRun, confirmDelete } = parseArgs(process.argv.slice(2));
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
      const decision = await collectBranchDecision(node, { owner, name, mainBranch, thresholdMs });
      if (decision.kind === "candidate") candidates.push(decision.candidate);
      if (decision.kind === "skip") skipped.push(decision.skipped);
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
    process.exit(1);
  }

  await deleteBranches(candidates);
}

if (import.meta.main) {
  await main();
}
