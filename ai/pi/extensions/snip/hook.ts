import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import { parseJsonWithSchema } from "@accel-os/shared/json";
import { Type } from "typebox";

const hookTimeoutMs = 500;
const hookMaxBufferBytes = 64 * 1024;

const hookOutputSchema = Type.Object(
  {
    hookSpecificOutput: Type.Optional(
      Type.Object(
        {
          updatedInput: Type.Optional(
            Type.Object(
              {
                command: Type.Optional(Type.String()),
              },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

export type SnipHookPayload = {
  tool_name: "bash";
  tool_input: Record<string, unknown>;
};

export type SnipHookOptions = {
  binaryPath?: string;
  signal?: AbortSignal;
  execute?: SnipHookExecutor;
};

export type SnipHookExecutor = (
  binaryPath: string,
  payload: SnipHookPayload,
  signal: AbortSignal | undefined,
) => Promise<string>;

export function defaultSnipBinaryPath(): string {
  return path.join(homedir(), ".local", "bin", "snip");
}

export function parseSnipHookOutput(output: string): string | undefined {
  const parsed = parseJsonWithSchema(output, hookOutputSchema, "snip hook output");
  return parsed.hookSpecificOutput?.updatedInput?.command;
}

const executeSnipHook: SnipHookExecutor = async (
  binaryPath: string,
  payload: SnipHookPayload,
  signal: AbortSignal | undefined,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      binaryPath,
      ["hook", "pi"],
      {
        encoding: "utf8",
        maxBuffer: hookMaxBufferBytes,
        timeout: hookTimeoutMs,
        ...(signal === undefined ? {} : { signal }),
      },
      (error, stdout) => {
        if (error !== null) {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- execFile reports ExecFileException, which extends Error.
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.end(JSON.stringify(payload));
  });

/**
 * Run snip's Pi-compatible hook without a shell, returning an updated command
 * only when snip elects to rewrite it.
 */
export async function runSnipHook(
  payload: SnipHookPayload,
  options: SnipHookOptions = {},
): Promise<string | undefined> {
  const stdout = await (options.execute ?? executeSnipHook)(
    options.binaryPath ?? defaultSnipBinaryPath(),
    payload,
    options.signal,
  );

  if (stdout.trim().length === 0) {
    return undefined;
  }
  return parseSnipHookOutput(stdout);
}
