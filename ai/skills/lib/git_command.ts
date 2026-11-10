import { runCommand } from "@accel-os/shared/process";

export type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
};

export type RunGitOptions = {
  stdin?: string | null;
};

export async function runGit(
  args: string[],
  options: RunGitOptions = {},
): Promise<GitCommandResult> {
  const stdin = options.stdin === undefined ? {} : { stdin: options.stdin };
  return runCommand("git", ["--no-pager", ...args], {
    env: {
      ...process.env,
      LC_ALL: "C",
      GIT_PAGER: "cat",
    },
    ...stdin,
  });
}
