export type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
};

export async function runGit(args: string[]): Promise<GitCommandResult> {
  const command = new Deno.Command("git", {
    args: ["--no-pager", ...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: {
      LC_ALL: "C",
      GIT_PAGER: "cat",
    },
  });

  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: decode(stdout).trimEnd(),
    stderr: decode(stderr).trimEnd(),
    success: code === 0,
  };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
