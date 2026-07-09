import { execFile } from "node:child_process";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  success: boolean;
};

export type RunCommandOptions = {
  env?: NodeJS.ProcessEnv;
  stdin?: string | null;
};

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        env: options.env,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = typeof error?.code === "number" ? error.code : 0;
        resolve({
          code,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
          success: code === 0,
        });
      },
    );

    child.on("error", reject);

    if (options.stdin === undefined || options.stdin === null) {
      child.stdin?.end();
      return;
    }

    child.stdin?.end(options.stdin);
  });
}
