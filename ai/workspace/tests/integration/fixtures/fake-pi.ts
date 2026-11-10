import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Type } from "typebox";
import { Value } from "typebox/value";

const CommandSchema = Type.Object({
  type: Type.String(),
  id: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  cancelled: Type.Optional(Type.Boolean()),
});
const stateDirectory = path.resolve(process.env["FAKE_PI_STATE"] ?? "");
if (!process.env["FAKE_PI_STATE"]) throw new Error("Fake Pi requires isolated state");
let running = false;
let tool: ChildProcess | null = null;
let buffer = "";
let dialogCommand: string | undefined;

function send(record: object): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function stopTool(): Promise<void> {
  if (!tool) return;
  const closed = once(tool, "exit");
  tool.kill("SIGTERM");
  await closed;
  tool = null;
}

async function handle(line: string): Promise<void> {
  const command: unknown = JSON.parse(line);
  if (!Value.Check(CommandSchema, command)) throw new Error("Invalid test command");
  const respond = (data?: unknown): void => {
    send({ type: "response", id: command.id, command: command.type, success: true, data });
  };
  switch (command.type) {
    case "get_state":
      respond({ sessionId: "isolated-test-session", isStreaming: running, isCompacting: false });
      break;
    case "get_messages":
      respond({ messages: [] });
      break;
    case "prompt": {
      if (command.message === "crash") process.exit(17);
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
      respond({ disposition: "started" });
      running = true;
      send({ type: "agent_start" });
      send({ type: "message_end", message: { role: "user", content: command.message ?? "" } });
      if (command.message === "hold") {
        tool = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        await writeFile(path.join(stateDirectory, "tool-pid"), String(tool.pid));
        send({
          type: "tool_execution_start",
          toolName: "harmless-wait",
          toolCallId: "test-tool",
          args: {},
        });
        send({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Working…" },
        });
      } else {
        const text = "Hello from fake Pi. \u2028 \u2029 ☕";
        const record = Buffer.from(
          `${JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: text },
          })}\r\n`,
        );
        // Exercise both split UTF-8 and CRLF framing without timer-based synchronization.
        process.stdout.write(record.subarray(0, record.length - 4));
        process.stdout.write(record.subarray(record.length - 4));
        send({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Hello from fake Pi." }] },
        });
        send({ type: "agent_end", messages: [] });
        running = false;
        send({ type: "agent_settled", aborted: false });
      }
      break;
    }
    case "abort":
      await stopTool();
      running = false;
      send({ type: "agent_settled", aborted: true });
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
