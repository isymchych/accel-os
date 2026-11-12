import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test, { mock } from "node:test";
import { setImmediate } from "node:timers/promises";

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import type { HistoryEntryId } from "../../src/desktop-api.ts";
import { contentText } from "./fixtures/helpers.ts";

const CommandSchema = Type.Object({
  id: Type.String(),
  type: Type.String(),
  message: Type.Optional(Type.String()),
});
type Command = Static<typeof CommandSchema>;

// Control the real transport's input streams, not its framing, request, or session logic.
class ControlledChild extends EventEmitter {
  public readonly pid = 424242;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly commands: Command[] = [];
  public onCommand: (command: Command) => void = () => {};
  public holdWrites = false;
  public ignoreEnd = false;
  public releaseWrite: (() => void) | undefined;
  public readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, callback): void => {
      const command: unknown = JSON.parse(chunk.toString("utf8"));
      assert.ok(Value.Check(CommandSchema, command));
      this.commands.push(command);
      this.onCommand(command);
      if (this.holdWrites) this.releaseWrite = callback;
      else callback();
    },
  });

  public constructor() {
    super();
    this.stdin.on("finish", () => {
      if (this.ignoreEnd) return;
      this.stdout.end();
      this.stderr.end();
      this.emit("close", 0, null);
    });
  }

  public send(record: object): void {
    this.stdout.write(`${JSON.stringify(record)}\n`);
  }

  public respond(command: Command, fields: Record<string, unknown> = {}): void {
    this.send({
      type: "response",
      id: command.id,
      command: command.type,
      success: true,
      ...fields,
    });
  }
}

let child: ControlledChild;
mock.module("node:child_process", { exports: { spawn: () => child } });
const { PiRpc } = await import("../../src/backend/rpc.ts");
const { DesktopSession } = await import("../../src/backend/session.ts");
const launch = { executable: "/unused/node", args: [], cwd: "/unused", env: {} };

test("a closed transport cannot start a Pi child", async () => {
  child = new ControlledChild();
  const rpc = new PiRpc(launch);
  await rpc.close();
  assert.throws(() => {
    rpc.start();
  }, /closed/u);
});

function transport(t: test.TestContext): InstanceType<typeof PiRpc> {
  child = new ControlledChild();
  const rpc = new PiRpc(launch);
  t.after(async () => {
    await rpc.close();
  });
  rpc.start();
  return rpc;
}

async function sessionFixture(t: test.TestContext): Promise<InstanceType<typeof DesktopSession>> {
  child = new ControlledChild();
  child.onCommand = (command): void => {
    if (command.type === "get_state") {
      child.respond(command, {
        data: { sessionId: "controlled-session", isStreaming: false, isCompacting: false },
      });
    } else if (command.type === "get_messages") {
      child.respond(command, { data: { messages: [] } });
    } else if (command.type === "prompt") {
      child.respond(command, { data: { disposition: "started" } });
      child.send({ type: "agent_start" });
    }
  };
  const session = new DesktopSession(launch);
  t.after(async () => {
    await session.close();
  });
  await session.start();
  return session;
}

test("JSONL framing preserves split UTF-8, Unicode separators, CRLF, and batched records", (t) => {
  const rpc = transport(t);
  const received: object[] = [];
  rpc.subscribe((record) => {
    received.push(record);
  });
  const record = {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "before\u2028middle\u2029☕after" },
  };
  const bytes = Buffer.from(JSON.stringify(record));
  const split = bytes.indexOf(Buffer.from("☕")) + 1;
  child.stdout.write(bytes.subarray(0, split));
  assert.deepEqual(received, []);
  child.stdout.write(bytes.subarray(split));
  child.stdout.write("\r");
  assert.deepEqual(received, [], "Only LF completes a record");
  child.stdout.write('\n\n{"type":"agent_settled","aborted":false}\n');
  assert.deepEqual(received, [record, { type: "agent_settled", aborted: false }]);
});

test("responses correlate by ID even when commands finish out of order", async (t) => {
  const rpc = transport(t);
  const first = rpc.request("get_state");
  const second = rpc.request("get_messages");
  const [firstCommand, secondCommand] = child.commands;
  assert.ok(firstCommand && secondCommand);
  child.respond({ id: "unrelated", type: "get_state" });
  child.respond(secondCommand, { data: { messages: [] } });
  assert.deepEqual((await second).data, { messages: [] });
  child.respond(firstCommand, { data: { sessionId: "first" } });
  assert.deepEqual((await first).data, { sessionId: "first" });
});

test("a matching response ID with the wrong command rejects the request", async (t) => {
  const rpc = transport(t);
  const rejected = assert.rejects(rpc.request("prompt"), /response command mismatch/u);
  const command = child.commands[0];
  assert.ok(command);
  child.respond(command, { command: "abort" });
  await rejected;
});

test("dialog responses wait for stdin drain without duplicating writes", async (t) => {
  const rpc = transport(t);
  child.holdWrites = true;
  let delivered = false;
  const delivery = rpc.cancelDialog("x".repeat(100_000)).then(() => {
    delivered = true;
  });
  assert.equal(child.stdin.writableNeedDrain, true);
  await setImmediate();
  assert.equal(delivered, false, "A buffered write is not yet drained");
  assert.ok(child.releaseWrite);
  child.releaseWrite();
  await delivery;
  assert.equal(delivered, true);
  assert.equal(child.commands.length, 1);
  assert.equal(child.commands[0]?.type, "extension_ui_response");
});

test("shutdown escalates an unresponsive child to process-group termination", async (t) => {
  const rpc = transport(t);
  child.ignoreEnd = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: unknown[][] = [];
  t.mock.method(process, "kill", (pid: number, signal: NodeJS.Signals) => {
    signals.push([pid, signal]);
    if (signal === "SIGKILL") child.emit("close", null, signal);
    return true;
  });
  const closed = rpc.close();
  await setImmediate();
  t.mock.timers.tick(4_999);
  await setImmediate();
  assert.deepEqual(signals, []);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.deepEqual(signals, [[-child.pid, "SIGTERM"]]);
  t.mock.timers.tick(1_000);
  await closed;
  assert.deepEqual(signals, [
    [-child.pid, "SIGTERM"],
    [-child.pid, "SIGKILL"],
  ]);
  await assert.rejects(rpc.request("get_state"), /Pi exited/u);
});

(
  [
    ["malformed JSON", (): string => "{bad json}\n"],
    ["invalid record", (): string => '{"type":42}\n'],
    ...["{bad json}", JSON.stringify({ type: "workspace_result", id: "control" })].map(
      (message, index) =>
        [
          `invalid bridge result ${index + 1}`,
          (): string =>
            `${JSON.stringify({
              type: "extension_ui_request",
              id: "notification",
              method: "notify",
              message: `workspace-control:${message}`,
            })}\n`,
        ] as const,
    ),
    ["oversized complete record", (): string => `${"x".repeat(16 * 1024 * 1024 + 1)}\n`],
    ["oversized unfinished record", (): string => "x".repeat(16 * 1024 * 1024 + 1)],
  ] as const
).forEach(([name, output]) => {
  test(`${name} fails the connection and rejects all pending requests`, async (t) => {
    const rpc = transport(t);
    const failures: string[] = [];
    rpc.onExit((error) => {
      failures.push(error.message);
    });
    const first = assert.rejects(rpc.request("prompt"), /invalid or oversized RPC output/u);
    const second = assert.rejects(rpc.request("get_state"), /invalid or oversized RPC output/u);
    child.stdout.write(output());
    await Promise.all([first, second]);
    assert.equal(failures.length, 1);
    await assert.rejects(rpc.request("prompt"), /invalid or oversized RPC output/u);
  });
});

test("Stop remains stopping until Pi acknowledges cancellation", async (t) => {
  const session = await sessionFixture(t);
  await session.prompt("hold");
  const stopped = session.stop();
  assert.equal(session.snapshot().execution, "stopping");
  child.send({ type: "agent_settled", aborted: true });
  assert.equal(
    session.snapshot().execution,
    "stopping",
    "Settled before the abort response is not Stop confirmation",
  );
  assert.notEqual(session.snapshot().notice, "Stopped.");
  const command = child.commands.at(-1);
  assert.ok(command);
  assert.equal(command.type, "abort");
  await session.stop();
  assert.equal(child.commands.filter((value) => value.type === "abort").length, 1);
  assert.equal(session.snapshot().execution, "stopping");
  child.respond(command);
  await stopped;
  assert.equal(session.snapshot().execution, "idle");
  assert.equal(session.snapshot().notice, "Stopped.");
});

test("streaming bursts coalesce history snapshots and final messages flush immediately", async (t) => {
  const session = await sessionFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  child.send({ type: "message_end", message: { role: "user", content: "history".repeat(10_000) } });
  const snapshots: string[] = [];
  session.subscribe((snapshot) => {
    snapshots.push(contentText(snapshot.streaming));
  });
  for (let index = 0; index < 1_000; index += 1) {
    child.send({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "x" },
    });
  }
  assert.deepEqual(snapshots, [], "Do not clone and publish full history per delta");
  t.mock.timers.tick(40);
  assert.deepEqual(snapshots, ["x".repeat(1_000)]);
  child.send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "unfinished tail" },
  });
  assert.equal(snapshots.length, 1);
  child.send({
    type: "message_end",
    message: { role: "assistant", content: "authoritative output" },
  });
  assert.deepEqual(snapshots, ["x".repeat(1_000), ""]);
  assert.equal(contentText(session.snapshot().messages.at(-1)?.content), "authoritative output");
  t.mock.timers.tick(80);
  assert.deepEqual(snapshots, ["x".repeat(1_000), ""], "Completion cancels pending publication");
});

test("missing desktop bridge rejects without submitting control text as model input", async (t) => {
  const rpc = transport(t);
  child.onCommand = (command): void => {
    assert.equal(command.type, "get_commands");
    child.respond(command, { data: { commands: [{ name: "another-command" }] } });
  };
  await assert.rejects(rpc.control("list", "/project"), /bridge is unavailable/u);
  assert.deepEqual(
    child.commands.map((command) => command.type),
    ["get_commands"],
  );
});

function controlResult(command: Command, fields: Record<string, unknown>): void {
  assert.ok(command.message);
  assert.ok(command.message.startsWith("/workspace-control "));
  const request: unknown = JSON.parse(command.message.slice("/workspace-control ".length));
  const schema = Type.Object({ id: Type.String() });
  assert.ok(Value.Check(schema, request));
  child.send({
    type: "extension_ui_request",
    id: "notification",
    method: "notify",
    message: `workspace-control:${JSON.stringify({
      type: "workspace_result",
      id: request.id,
      success: true,
      ...fields,
    })}`,
  });
}

test("concurrent bridge operations correlate results independently of notification order", async (t) => {
  const rpc = transport(t);
  const observed: object[] = [];
  rpc.subscribe((record) => {
    observed.push(record);
  });
  child.onCommand = (command): void => {
    if (command.type === "get_commands")
      child.respond(command, { data: { commands: [{ name: "workspace-control" }] } });
  };
  const list = rpc.control("list", "/project");
  const snapshot = rpc.control("snapshot", "entry");
  await setImmediate();
  const [first, second] = child.commands.filter((command) => command.type === "prompt");
  assert.ok(first && second);
  controlResult(first, { id: "unrelated", data: "must not be used" });
  controlResult(second, { data: { path: "/fork.jsonl" } });
  child.respond(second);
  assert.deepEqual(await snapshot, { path: "/fork.jsonl" });
  controlResult(first, { data: [] });
  child.respond(first);
  assert.deepEqual(await list, []);
  assert.equal(child.commands.filter((command) => command.type === "prompt").length, 2);
  controlResult(first, { data: "late result" });
  const notice = {
    type: "extension_ui_request",
    id: "user-notification",
    method: "notify",
    message: "Ordinary Pi notification",
  };
  child.send(notice);
  assert.deepEqual(observed, [notice], "Bridge results stay private to the transport");
});

test("bridge failures and unmatched results reject without replay and allow later controls", async (t) => {
  const rpc = transport(t);
  let attempt = 0;
  child.onCommand = (command): void => {
    if (command.type === "get_commands") {
      child.respond(command, { data: { commands: [{ name: "workspace-control" }] } });
      return;
    }
    assert.equal(command.type, "prompt");
    attempt += 1;
    if (attempt === 1)
      controlResult(command, { success: false, error: "Snapshot entry is missing" });
    else if (attempt === 2)
      controlResult(command, { id: "another-operation", data: { path: "/wrong.jsonl" } });
    else controlResult(command, { data: { path: "/confirmed.jsonl" } });
    child.respond(command, { data: { disposition: "handled" } });
  };
  await assert.rejects(rpc.control("snapshot", "missing"), /Snapshot entry is missing/u);
  await assert.rejects(rpc.control("snapshot", "entry"), /did not confirm/u);
  assert.deepEqual(await rpc.control("snapshot", "entry"), { path: "/confirmed.jsonl" });
  assert.equal(attempt, 3, "Each explicit operation is submitted once, without fallback or replay");
});

test("rejected controls preserve history and release the mutation guard", async (t) => {
  const session = await sessionFixture(t);
  child.send({ type: "message_end", message: { role: "user", content: "original history" } });
  const history = session.snapshot().messages;
  child.onCommand = (command): void => {
    if (command.type === "get_commands")
      child.respond(command, { data: { commands: [{ name: "workspace-control" }] } });
    else if (command.type === "prompt") {
      controlResult(command, { data: { cancelled: true } });
      child.respond(command, { data: { disposition: "handled" } });
    } else if (command.type === "set_model")
      child.respond(command, { success: false, error: "Model is unavailable" });
    else if (command.type === "get_state")
      child.respond(command, {
        data: {
          sessionId: "controlled-session",
          isStreaming: false,
          isCompacting: false,
          model: { provider: "fixture", id: "original" },
          thinkingLevel: "off",
        },
      });
    else if (command.type === "get_available_models")
      child.respond(command, { data: { models: [] } });
    else if (command.type === "get_available_thinking_levels")
      child.respond(command, { data: { levels: ["off"] } });
    else throw new Error(`Unexpected command: ${command.type}`);
  };
  await assert.rejects(
    session.navigate("entry" as HistoryEntryId),
    /cancelled history navigation/u,
  );
  await assert.rejects(session.model("fixture", "missing"), /Model is unavailable/u);
  await assert.rejects(session.thinking("high"), /Unsupported thinking level/u);
  assert.deepEqual(session.snapshot().messages, history);
  assert.equal(session.snapshot().execution, "idle");
  assert.deepEqual((await session.controls()).model, { provider: "fixture", id: "original" });
  assert.equal(
    child.commands.some((command) => command.type === "set_thinking_level"),
    false,
  );
  assert.equal(
    child.commands.filter((command) => command.type === "get_messages").length,
    1,
    "Cancelled navigation must not refresh or replace history",
  );
});

test("rejected cancellation is unknown, not a successful Stop", async (t) => {
  const session = await sessionFixture(t);
  await session.prompt("hold");
  const stopped = assert.rejects(session.stop(), /Cannot abort/u);
  const command = child.commands.at(-1);
  assert.ok(command);
  child.respond(command, { success: false, error: "Cannot abort" });
  await stopped;
  assert.equal(session.snapshot().execution, "unknown");
  assert.equal(session.snapshot().error, "Pi has not confirmed cancellation.");
  assert.notEqual(session.snapshot().notice, "Stopped.");
});

test("native bash messages on active and abandoned branches remain readable", async (t) => {
  const session = await sessionFixture(t);
  const bash = {
    role: "bashExecution",
    command: "printf fixture",
    output: "fixture",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 1,
  };
  child.onCommand = (command): void => {
    if (command.type === "get_state")
      child.respond(command, {
        data: { sessionId: "controlled-session", isStreaming: false, isCompacting: false },
      });
    else if (command.type === "get_entries")
      child.respond(command, {
        data: {
          entries: [{ id: "bash", parentId: null, type: "message", message: bash }],
          leafId: null,
        },
      });
    else if (command.type === "get_messages")
      child.respond(command, { data: { messages: [bash] } });
  };
  assert.deepEqual(await session.history(), {
    entries: [{ id: "bash", parentId: null, label: "bashExecution: $ printf fixture\nfixture" }],
    leafId: null,
  });
  await session.refresh();
  assert.deepEqual(session.snapshot().messages, [
    {
      role: "bashExecution",
      content: [{ type: "text", text: "$ printf fixture\nfixture" }],
      isError: false,
    },
  ]);
  child.send({ type: "message_end", message: { ...bash, exitCode: 1 } });
  assert.equal(session.snapshot().messages.at(-1)?.isError, true);
  assert.equal(session.snapshot().connection, "connected");
});

test("ordered content survives streaming, tool events and history refresh", async (t) => {
  const session = await sessionFixture(t);
  const image = { type: "image", mimeType: "image/png", data: "aW1hZ2U=" };
  child.send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Before" },
  });
  child.send({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "Reasoning" },
  });
  child.send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 2, delta: "After" },
  });
  assert.deepEqual(session.snapshot().streaming, [
    { type: "text", text: "Before" },
    { type: "thinking", text: "Reasoning" },
    { type: "text", text: "After" },
  ]);
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: "Before" },
      { type: "thinking", thinking: "Reasoning" },
      image,
      { type: "text", text: "After" },
    ],
  };
  child.send({ type: "message_end", message });
  assert.deepEqual(session.snapshot().streaming, []);
  assert.deepEqual(session.snapshot().messages.at(-1), {
    role: "assistant",
    content: [
      { type: "text", text: "Before" },
      { type: "thinking", text: "Reasoning" },
      image,
      { type: "text", text: "After" },
    ],
    isError: false,
  });
  child.send({
    type: "tool_execution_end",
    toolCallId: "image-tool",
    toolName: "read",
    result: { content: [{ type: "text", text: "Before" }, image, { type: "text", text: "After" }] },
  });
  assert.deepEqual(session.snapshot().tools.at(-1)?.content, [
    { type: "text", text: "Before" },
    image,
    { type: "text", text: "After" },
  ]);
  child.onCommand = (command): void => {
    if (command.type === "get_state")
      child.respond(command, {
        data: { sessionId: "controlled-session", isStreaming: false, isCompacting: false },
      });
    else if (command.type === "get_messages")
      child.respond(command, { data: { messages: [message] } });
  };
  await session.refresh();
  assert.deepEqual(session.snapshot().messages[0]?.content, [
    { type: "text", text: "Before" },
    { type: "thinking", text: "Reasoning" },
    image,
    { type: "text", text: "After" },
  ]);
});

test("agent_end does not complete execution before agent_settled", async (t) => {
  const session = await sessionFixture(t);
  await session.prompt("work with automatic continuation");
  child.send({ type: "agent_end", messages: [] });
  assert.equal(session.snapshot().execution, "running");
  await assert.rejects(session.prompt("too early"), /connected and ready/u);
  child.send({ type: "agent_settled", aborted: false });
  assert.equal(session.snapshot().execution, "idle");
});

test("controls and history invalidate independently, not on notices or streaming deltas", async (t) => {
  const session = await sessionFixture(t);
  const initial = session.snapshot();
  child.send({ type: "extension_ui_request", id: "notice", method: "notify", message: "Hello" });
  child.send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "partial" },
  });
  assert.equal(session.snapshot().controlsRevision, initial.controlsRevision);
  assert.equal(session.snapshot().historyRevision, initial.historyRevision);
  await session.prompt("work");
  const submitted = session.snapshot();
  assert.ok(submitted.controlsRevision > initial.controlsRevision);
  assert.equal(submitted.historyRevision, initial.historyRevision);
  child.send({ type: "message_end", message: { role: "user", content: "work" } });
  const completed = session.snapshot();
  assert.ok(completed.controlsRevision > submitted.controlsRevision);
  assert.ok(completed.historyRevision > submitted.historyRevision);
  child.send({ type: "agent_settled", aborted: false });
  assert.ok(session.snapshot().controlsRevision > completed.controlsRevision);
  assert.ok(session.snapshot().historyRevision > completed.historyRevision);
});

test("lost prompt confirmation times out without resending accepted input", async (t) => {
  const session = await sessionFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  child.onCommand = (command): void => {
    assert.equal(command.type, "prompt");
    child.send({ type: "agent_start" });
    child.send({ type: "message_end", message: { role: "user", content: command.message } });
    // Pi accepted the input, but its command response never arrives.
  };
  const rejected = assert.rejects(session.prompt("accepted once"), /Do not automatically retry/u);
  t.mock.timers.tick(29_999);
  await setImmediate();
  assert.equal(session.snapshot().error, null);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(session.snapshot().execution, "running");
  assert.match(session.snapshot().error ?? "", /did not confirm prompt within 30 seconds/u);
  assert.deepEqual(
    session.snapshot().messages.map((message) => contentText(message.content)),
    ["accepted once"],
  );
  t.mock.timers.tick(60_000);
  await assert.rejects(session.prompt("accepted once"), /connected and ready/u);
  assert.equal(child.commands.filter((command) => command.type === "prompt").length, 1);
});
