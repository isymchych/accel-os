import { runCommand } from "@accel-os/shared/process";

export type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
};

export async function runGit(args: string[]): Promise<GitCommandResult> {
  return await runCommand("git", ["--no-pager", ...args], {
    env: {
      ...process.env,
      LC_ALL: "C",
      GIT_PAGER: "cat",
    },
  });
}
