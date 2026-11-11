import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { watch } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const CommandSchema = Type.Object({
  type: Type.String(),
  id: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  streamingBehavior: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
  cancelled: Type.Optional(Type.Boolean()),
  provider: Type.Optional(Type.String()),
  modelId: Type.Optional(Type.String()),
  level: Type.Optional(Type.String()),
});
const MessageSchema = Type.Union([
  Type.Object({ role: Type.String(), content: Type.String() }),
  Type.Object({
    role: Type.Union([Type.Literal("compactionSummary"), Type.Literal("branchSummary")]),
    summary: Type.String(),
  }),
]);
const StoredSchema = Type.Object({
  id: Type.String(),
  cwd: Type.String(),
  name: Type.String(),
  modified: Type.String(),
  leafId: Type.Union([Type.String(), Type.Null()]),
  entries: Type.Array(
    Type.Object({
      id: Type.String(),
      parentId: Type.Union([Type.String(), Type.Null()]),
      type: Type.Literal("message"),
      message: MessageSchema,
    }),
  ),
});
const ControlSchema = Type.Object({
  id: Type.String(),
  operation: Type.String(),
  value: Type.String(),
});
const stateDirectory = path.resolve(process.env["FAKE_PI_STATE"] ?? "");
if (!process.env["FAKE_PI_STATE"]) throw new Error("Fake Pi requires isolated state");
const nativeDirectory = path.join(stateDirectory, "native");
await mkdir(nativeDirectory, { recursive: true });
const sessionArgument = process.argv.indexOf("--session");
const sessionPath = sessionArgument >= 0 ? process.argv[sessionArgument + 1] : undefined;
let stored: Static<typeof StoredSchema> = {
  id: randomUUID(),
  cwd: process.cwd(),
  name: "Test session",
  modified: new Date().toISOString(),
  leafId: null,
  entries: [],
};
if (sessionPath) {
  const value: unknown = JSON.parse(await readFile(sessionPath, "utf8"));
  if (!Value.Check(StoredSchema, value)) throw new Error("Invalid saved fake session");
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
async function message(role: string, content: string): Promise<void> {
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
function branchMessages(): Static<typeof MessageSchema>[] {
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
  if (!Value.Check(ControlSchema, value)) throw new Error("Invalid fake control");
  let data: unknown;
  switch (value.operation) {
    case "list": {
      const sessions = [];
      for (const name of await readdir(nativeDirectory)) {
        if (!name.endsWith(".jsonl")) continue;
        const sessionFile = path.join(nativeDirectory, name);
        const session: unknown = JSON.parse(await readFile(sessionFile, "utf8"));
        if (Value.Check(StoredSchema, session) && session.cwd === value.value) {
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
async function prompt(
  command: Static<typeof CommandSchema>,
  respond: (data?: unknown) => void,
): Promise<void> {
  if (command.message?.startsWith("/workspace-control ")) {
    try {
      await control(command.message);
    } catch (error) {
      const request: unknown = JSON.parse(command.message.slice("/workspace-control ".length));
      if (Value.Check(ControlSchema, request))
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
    await appendFile(
      path.join(stateDirectory, "queue.jsonl"),
      `${JSON.stringify({
        sessionId: stored.id,
        type: command.streamingBehavior === "followUp" ? "follow_up" : "steer",
        message: command.message,
      })}\n`,
    );
    queue.push(command.message ?? "");
    respond({ disposition: "queued" });
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
  if (command.message === "hold") {
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
      command.message === "long-output"
        ? `Large output\n${"x".repeat(50_000)}\nEND_OF_LONG_OUTPUT`
        : "Hello from fake Pi.",
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
  if (!Value.Check(CommandSchema, command)) throw new Error("Invalid test command");
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
