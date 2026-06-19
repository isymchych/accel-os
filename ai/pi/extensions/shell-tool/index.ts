/**
 * Replace Pi's built-in `bash` tool with a shell execution wrapper owned by this config.
 *
 * The wrapper keeps Pi's built-in execution/result rendering behavior while giving us a
 * stable local place to add shell-tool capabilities. Today it adds per-call `cwd` support.
 */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  createBashToolDefinition,
  defineTool,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type BashToolDetails,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

export const shellToolSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for this command. Relative paths resolve from the session working directory.",
    }),
  ),
});

type ShellToolParams = Static<typeof shellToolSchema>;

interface ShellToolRenderState {
  startedAt: number | undefined;
  endedAt: number | undefined;
  interval: NodeJS.Timeout | undefined;
}

const resultRenderer = createBashToolDefinition(process.cwd());

function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

export function resolveShellToolCwd(sessionCwd: string, requestedCwd: string | undefined): string {
  if (requestedCwd === undefined || requestedCwd.length === 0) {
    return sessionCwd;
  }

  const expanded = expandHome(requestedCwd);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(sessionCwd, expanded);
}

export async function assertDirectory(filePath: string): Promise<void> {
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cwd does not exist: ${filePath}\n${message}`, { cause: error });
  }

  if (!metadata.isDirectory()) {
    throw new Error(`cwd is not a directory: ${filePath}`);
  }
}

function formatRelativeCwd(sessionCwd: string, commandCwd: string): string {
  const relativePath = path.relative(sessionCwd, commandCwd);
  return relativePath.length === 0 ? "." : relativePath;
}

function renderCall(
  args: ShellToolParams,
  theme: Theme,
  context: {
    cwd: string;
    executionStarted: boolean;
    lastComponent: unknown;
    state: ShellToolRenderState;
  },
): Text {
  const state = context.state;
  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
    state.endedAt = undefined;
  }

  const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const commandDisplay = args.command.length === 0 ? "..." : args.command;
  const commandCwd = resolveShellToolCwd(context.cwd, args.cwd);

  let line = theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`));
  if (args.cwd !== undefined && args.cwd.length > 0) {
    line += theme.fg("muted", ` (cwd ${formatRelativeCwd(context.cwd, commandCwd)})`);
  }
  if (args.timeout !== undefined) {
    line += theme.fg("muted", ` (timeout ${args.timeout}s)`);
  }

  text.setText(line);
  return text;
}

export async function executeShellTool(
  toolCallId: string,
  params: ShellToolParams,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<BashToolDetails | undefined> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<BashToolDetails | undefined>> {
  const commandCwd = resolveShellToolCwd(ctx.cwd, params.cwd);
  await assertDirectory(commandCwd);

  const bashTool = createBashToolDefinition(commandCwd);
  return bashTool.execute(
    toolCallId,
    params.timeout === undefined
      ? { command: params.command }
      : { command: params.command, timeout: params.timeout },
    signal,
    onUpdate,
    ctx,
  );
}

export default function shellToolExtension(pi: ExtensionAPI): void {
  const tool = defineTool<
    typeof shellToolSchema,
    BashToolDetails | undefined,
    ShellToolRenderState
  >({
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command. Returns stdout and stderr. Output is truncated to the last 2000 lines or 50KB. Optionally provide timeout in seconds and cwd for the command working directory.",
    promptSnippet: "Execute bash commands with optional per-command cwd",
    promptGuidelines: [
      "Use bash cwd when a command should run from a specific directory instead of prefixing the command with `cd ... &&`.",
      "Relative bash cwd values resolve from the session working directory.",
    ],
    parameters: shellToolSchema,
    execute: executeShellTool,
    renderCall,
    renderResult(result, options: ToolRenderResultOptions, theme, context) {
      if (resultRenderer.renderResult === undefined) {
        return new Text("", 0, 0);
      }
      return resultRenderer.renderResult(result, options, theme, context);
    },
  });

  pi.registerTool(tool);
}
