import { runGit } from "../../lib/git_command.ts";

if (process.argv.length > 2) usage();

const { code, stdout, stderr, success } = await runGit([
  "diff",
  "--staged",
  "--no-color",
  "--no-ext-diff",
]);
if (success) {
  if (stdout !== "") console.log(stdout);
  process.exit(0);
}

const errorText = stderr || stdout || `git exited with status ${code}`;
if (/not a git repository/i.test(errorText)) {
  console.error(`ERR_NOT_REPO: ${errorText}`);
  process.exit(65);
}

console.error(`ERR_GIT: ${errorText}`);
process.exit(66);

function usage(): never {
  console.error("ERR_USAGE: expected no args");
  process.exit(64);
}
