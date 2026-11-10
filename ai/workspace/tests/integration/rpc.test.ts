import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test, { mock } from "node:test";
import { setImmediate } from "node:timers/promises";

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const CommandSchema = Type.Object({
  id: Type.String(),
  type: Type.String(),
  message: Type.Optional(Type.String()),
});
type Command = Static<typeof CommandSchema>;

// Control the real transport's input streams, not its framing, request, or session logic.
class ControlledChild extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly commands: Command[] = [];
  public onCommand: (command: Command) => void = () => {};
  public readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, callback): void => {
      const command: unknown = JSON.parse(chunk.toString("utf8"));
      assert.ok(Value.Check(CommandSchema, command));
      this.commands.push(command);
      this.onCommand(command);
      callback();
    },
  });

  public constructor() {
    super();
    this.stdin.on("finish", () => {
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
const { PiRpc } = await import("../../src/electron/rpc.ts");
const { DesktopSession } = await import("../../src/electron/session.ts");
const launch = { executable: "/unused/node", args: [], cwd: "/unused", env: {} };

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

(
  [
    ["malformed JSON", (): string => "{bad json}\n"],
    ["invalid record", (): string => '{"type":42}\n'],
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

test("agent_end does not complete execution before agent_settled", async (t) => {
  const session = await sessionFixture(t);
  await session.prompt("work with automatic continuation");
  child.send({ type: "agent_end", messages: [] });
  assert.equal(session.snapshot().execution, "running");
  await assert.rejects(session.prompt("too early"), /connected and idle/u);
  child.send({ type: "agent_settled", aborted: false });
  assert.equal(session.snapshot().execution, "idle");
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
    session.snapshot().messages.map((message) => message.text),
    ["accepted once"],
  );
  t.mock.timers.tick(60_000);
  await assert.rejects(session.prompt("accepted once"), /connected and idle/u);
  assert.equal(child.commands.filter((command) => command.type === "prompt").length, 1);
});
