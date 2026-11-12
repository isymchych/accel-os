import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { watch } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Schema, Struct } from "effect";

const CommandSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  streamingBehavior: Schema.optionalKey(
    Schema.Union([Schema.Literal("steer"), Schema.Literal("followUp")]),
  ),
  cancelled: Schema.optionalKey(Schema.Boolean),
  provider: Schema.optionalKey(Schema.String),
  modelId: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey));
const MessageSchema = Schema.Union([
  Schema.Struct({
    role: Schema.String,
    content: Schema.Union([
      Schema.String,
      Schema.mutable(
        Schema.Array(
          Schema.Struct({
            type: Schema.String,
            text: Schema.optionalKey(Schema.String),
            thinking: Schema.optionalKey(Schema.String),
            data: Schema.optionalKey(Schema.String),
            mimeType: Schema.optionalKey(Schema.String),
          }).mapFields(Struct.map(Schema.mutableKey)),
        ),
      ),
    ]),
  }).mapFields(Struct.map(Schema.mutableKey)),
  Schema.Struct({
    role: Schema.Union([Schema.Literal("compactionSummary"), Schema.Literal("branchSummary")]),
    summary: Schema.String,
  }).mapFields(Struct.map(Schema.mutableKey)),
]);
const StoredSchema = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  name: Schema.String,
  modified: Schema.String,
  leafId: Schema.Union([Schema.String, Schema.Null]),
  entries: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        parentId: Schema.Union([Schema.String, Schema.Null]),
        type: Schema.Literal("message"),
        message: MessageSchema,
      }).mapFields(Struct.map(Schema.mutableKey)),
    ),
  ),
}).mapFields(Struct.map(Schema.mutableKey));
const ControlSchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.String,
  value: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey));
const stateDirectory = path.resolve(process.env["FAKE_PI_STATE"] ?? "");
if (!process.env["FAKE_PI_STATE"]) throw new Error("Fake Pi requires isolated state");
const nativeDirectory = path.join(stateDirectory, "native");
await mkdir(nativeDirectory, { recursive: true });
const sessionArgument = process.argv.indexOf("--session");
const sessionPath = sessionArgument >= 0 ? process.argv[sessionArgument + 1] : undefined;
let stored: typeof StoredSchema.Type = {
  id: randomUUID(),
  cwd: process.cwd(),
  name: "Test session",
  modified: new Date().toISOString(),
  leafId: null,
  entries: [],
};
if (sessionPath) {
  const value: unknown = JSON.parse(await readFile(sessionPath, "utf8"));
  if (!Schema.is(StoredSchema)(value)) throw new Error("Invalid saved fake session");
  stored = value;
}
const file = sessionPath ?? path.join(nativeDirectory, `${stored.id}.jsonl`);
let running = false;
let tool: ChildProcess | null = null;
let buffer = "";
let dialogCommand: string | undefined;
let model = "fixture";
let thinking = "off";
const queue: string[] = [];

function send(record: object): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
function controlResult(record: object): void {
  send({
    type: "extension_ui_request",
    id: randomUUID(),
    method: "notify",
    message: `workspace-control:${JSON.stringify(record)}`,
  });
}
async function persist(): Promise<void> {
  stored.modified = new Date().toISOString();
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(stored));
  await rename(temporary, file);
}
async function message(
  role: string,
  content:
    | string
    | { type: string; text?: string; thinking?: string; data?: string; mimeType?: string }[],
): Promise<void> {
  const entry = {
    id: randomUUID(),
    parentId: stored.leafId,
    type: "message" as const,
    message: { role, content },
  };
  stored.entries.push(entry);
  stored.leafId = entry.id;
  await persist();
  send({ type: "message_end", message: { role, content } });
}
function branchMessages(): (typeof MessageSchema.Type)[] {
  const branch = [];
  let leaf = stored.leafId;
  while (leaf) {
    const current = leaf;
    const entry = stored.entries.find((item) => item.id === current);
    if (!entry) break;
    branch.unshift(entry.message);
    leaf = entry.parentId;
  }
  return branch;
}
async function stopTool(): Promise<void> {
  if (!tool) return;
  const closed = once(tool, "exit");
  tool.kill("SIGTERM");
  await closed;
  tool = null;
}
async function delayAcknowledgement(kind: "abort" | "prompt"): Promise<void> {
  const enabled = await readFile(path.join(stateDirectory, `delay-${kind}`), "utf8").then(
    () => true,
    () => false,
  );
  if (!enabled) return;
  await new Promise<void>((resolve, reject) => {
    const watcher = watch(stateDirectory, (_event, filename) => {
      if (filename !== `release-${kind}`) return;
      watcher.close();
      resolve();
    });
    watcher.once("error", reject);
    void writeFile(path.join(stateDirectory, `${kind}-pending`), "pending").catch(reject);
  });
}
async function control(messageText: string): Promise<void> {
  const value: unknown = JSON.parse(messageText.slice("/workspace-control ".length));
  if (!Schema.is(ControlSchema)(value)) throw new Error("Invalid fake control");
  let data: unknown;
  switch (value.operation) {
    case "list":
    case "list-all": {
      const sessions = [];
      for (const name of await readdir(nativeDirectory)) {
        if (!name.endsWith(".jsonl")) continue;
        const sessionFile = path.join(nativeDirectory, name);
        const session: unknown = JSON.parse(await readFile(sessionFile, "utf8"));
        if (
          Schema.is(StoredSchema)(session) &&
          (value.operation === "list-all" || session.cwd === value.value)
        ) {
          sessions.push({
            path: sessionFile,
            id: session.id,
            cwd: session.cwd,
            name: session.name,
            modified: session.modified,
          });
        }
      }
      data = sessions;
      break;
    }
    case "navigate": {
      if (running) throw new Error("Wait for the current response");
      const entry = stored.entries.find((item) => item.id === value.value);
      if (!entry) throw new Error("Missing entry");
      if (stored.leafId === entry.id) {
        data = { cancelled: false };
        break;
      }
      const editorText =
        entry.message.role === "user" && "content" in entry.message
          ? entry.message.content
          : undefined;
      stored.leafId = editorText === undefined ? entry.id : entry.parentId;
      await persist();
      data = { cancelled: false, editorText };
      break;
    }
    case "snapshot": {
      const index = stored.entries.findIndex((entry) => entry.id === value.value);
      if (index < 0) throw new Error("Missing entry");
      const id = randomUUID();
      const fork = path.join(nativeDirectory, `${id}.jsonl`);
      await writeFile(
        fork,
        JSON.stringify({
          ...stored,
          id,
          name: "Forked session",
          entries: stored.entries.slice(0, index + 1),
          leafId: value.value,
        }),
      );
      data = { path: fork };
      break;
    }
    default:
      throw new Error("Unknown fake control");
  }
  controlResult({ type: "workspace_result", id: value.id, success: true, data });
}
function completedText(promptText: string | undefined): string {
  if (promptText === "long-output")
    return `Large output\n${"x".repeat(50_000)}\nEND_OF_LONG_OUTPUT`;
  if (promptText !== "transcript-demo") return "Hello from fake Pi.";
  for (const [id, name, args, output, isError] of [
    ["read-demo", "read", { path: "src/renderer/session-view.tsx" }, "Read 120 lines.", false],
    [
      "bash-demo",
      "bash",
      { command: "pnpm run check" },
      "Typecheck failed: missing fixture.\n<img src=x onerror=alert(1)>",
      true,
    ],
  ] as const) {
    send({ type: "tool_execution_start", toolCallId: id, toolName: name, args });
    send({
      type: "tool_execution_end",
      toolCallId: id,
      toolName: name,
      isError,
      result: { content: [{ type: "text", text: output }] },
    });
  }
  return [
    "## Workspace review",
    "Keep **session ownership** explicit and preserve `drafts`.",
    "- Read configuration\n- Verify behavior",
    `\`\`\`ts\nconst path = "${"long-path/".repeat(35)}";\n\`\`\``,
    "| Check | Result |\n| --- | --- |\n| Draft | Preserved |",
    "[Documentation](https://example.com/docs)",
    "[Unsafe link](javascript:alert%281%29)",
    "![Remote image](https://example.com/private.png)",
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
  ].join("\n\n");
}

async function activePrompt(command: typeof CommandSchema.Type): Promise<string> {
  if (command.message === "__transcript_chunk__") {
    send({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta:
          "\n\nAnother finding: the draft belongs to its session and must survive navigation.\n\n".repeat(
            4,
          ),
      },
    });
    return "handled";
  }
  if (command.message === "__deliver_queued__") {
    const delivered = queue.shift();
    if (!delivered) throw new Error("No queued message to deliver");
    await message("user", delivered);
    return "handled";
  }
  await appendFile(
    path.join(stateDirectory, "queue.jsonl"),
    `${JSON.stringify({
      sessionId: stored.id,
      type: command.streamingBehavior === "followUp" ? "follow_up" : "steer",
      message: command.message,
    })}\n`,
  );
  queue.push(command.message ?? "");
  return "queued";
}

async function prompt(
  command: typeof CommandSchema.Type,
  respond: (data?: unknown) => void,
): Promise<void> {
  if (command.message?.startsWith("/workspace-control ")) {
    try {
      await control(command.message);
    } catch (error) {
      const request: unknown = JSON.parse(command.message.slice("/workspace-control ".length));
      if (Schema.is(ControlSchema)(request))
        controlResult({
          type: "workspace_result",
          id: request.id,
          success: false,
          error: String(error),
        });
    }
    respond({ disposition: "handled" });
    return;
  }
  if (running && command.streamingBehavior) {
    respond({ disposition: await activePrompt(command) });
    return;
  }
  await appendFile(
    path.join(stateDirectory, "prompts.jsonl"),
    `${JSON.stringify({ message: command.message })}\n`,
  );
  if (command.message === "crash") process.exit(17);
  if (command.message === "uncertain") {
    send({ type: "agent_start" });
    await message("user", command.message);
    process.stdout.end(() => process.exit(18));
    return;
  }
  if (command.message === "reject") {
    send({
      type: "response",
      id: command.id,
      command: "prompt",
      success: false,
      error: "Rejected test prompt",
    });
    return;
  }
  if (command.message === "/dialog") {
    dialogCommand = command.id;
    send({
      type: "extension_ui_request",
      id: "test-dialog",
      method: "confirm",
      title: "Test dialog",
    });
    return;
  }
  const delayed = command.message === "delayed";
  if (!delayed) respond({ disposition: "started" });
  running = true;
  send({ type: "agent_start" });
  await message("user", command.message ?? "");
  if (command.message === "transcript-stream") {
    send({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: `## Investigation\n\n${"Reading the workspace and checking session ownership before changing the renderer.\n\n".repeat(16)}`,
      },
    });
  } else if (command.message === "hold") {
    tool = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await writeFile(path.join(stateDirectory, "tool-pid"), String(tool.pid));
    send({
      type: "tool_execution_start",
      toolName: "harmless-wait",
      toolCallId: "test-tool",
      args: { purpose: "wait" },
    });
    send({
      type: "tool_execution_update",
      toolName: "harmless-wait",
      toolCallId: "test-tool",
      partialResult: { content: [{ type: "text", text: "Waiting for cancellation" }] },
    });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Working…" },
    });
  } else {
    const text = "Hello from fake Pi. \u2028 \u2029 ☕";
    const record = Buffer.from(
      `${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } })}\r\n`,
    );
    process.stdout.write(record.subarray(0, record.length - 4));
    process.stdout.write(record.subarray(record.length - 4));
    await message(
      "assistant",
      command.message === "ordered-content"
        ? [
            { type: "text", text: "First text" },
            { type: "thinking", thinking: "Private reasoning" },
            {
              type: "image",
              mimeType: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==",
            },
            { type: "text", text: "Last text" },
          ]
        : completedText(command.message),
    );
    send({ type: "agent_end", messages: [] });
    running = false;
    send({ type: "agent_settled", aborted: false });
  }
  if (delayed) {
    await delayAcknowledgement("prompt");
    respond({ disposition: "started" });
  }
}

async function handle(line: string): Promise<void> {
  const command: unknown = JSON.parse(line);
  if (!Schema.is(CommandSchema)(command)) throw new Error("Invalid test command");
  const respond = (data?: unknown): void => {
    send({ type: "response", id: command.id, command: command.type, success: true, data });
  };
  switch (command.type) {
    case "get_state":
      respond({
        sessionId: stored.id,
        sessionFile: file,
        sessionName: stored.name,
        isStreaming: running,
        isCompacting: false,
        model: { provider: "fake", id: model },
        thinkingLevel: thinking,
        pendingMessageCount: queue.length,
      });
      break;
    case "get_commands":
      respond({ commands: [{ name: "workspace-control" }] });
      break;
    case "get_available_models":
      respond({
        models: [
          { provider: "fake", id: "fixture", name: "Fixture" },
          { provider: "fake", id: "other", name: "Other" },
        ],
      });
      break;
    case "get_available_thinking_levels":
      respond({ levels: ["off", "low", "high"] });
      break;
    case "set_model":
      model = command.modelId ?? "fixture";
      respond();
      break;
    case "set_thinking_level":
      thinking = command.level ?? "off";
      respond();
      break;
    case "get_entries":
      respond({ entries: stored.entries, leafId: stored.leafId });
      break;
    case "get_messages":
      respond({ messages: branchMessages() });
      break;
    case "follow_up":
    case "steer":
      await appendFile(
        path.join(stateDirectory, "queue.jsonl"),
        `${JSON.stringify({ sessionId: stored.id, type: command.type, message: command.message })}\n`,
      );
      queue.push(command.message ?? "");
      respond({ disposition: "queued" });
      break;
    case "prompt":
      await prompt(command, respond);
      break;
    case "abort":
      await stopTool();
      running = false;
      send({
        type: "tool_execution_end",
        toolName: "harmless-wait",
        toolCallId: "test-tool",
        result: { content: [{ type: "text", text: "Harmless tool terminated" }] },
        isError: false,
      });
      send({ type: "agent_settled", aborted: true });
      await delayAcknowledgement("abort");
      respond();
      break;
    case "extension_ui_response":
      if (command.id !== "test-dialog" || !command.cancelled)
        throw new Error("Expected explicit dialog cancellation");
      send({
        type: "response",
        id: dialogCommand,
        command: "prompt",
        success: true,
        data: { disposition: "handled" },
      });
      break;
    default:
      throw new Error(`Unexpected test command: ${command.type}`);
  }
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    void handle(line).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
    newline = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => {
  void stopTool()
    .then(async () => {
      await writeFile(path.join(stateDirectory, "closed"), "clean");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
});
