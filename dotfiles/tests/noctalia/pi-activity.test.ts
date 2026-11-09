import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseJsonWithSchema } from "@accel-os/shared/json";
import { Type } from "typebox";

import {
  ActivityMonitor,
  collectActivity,
  type ActivityStatus,
  type AgentCounts,
} from "../../dot_config/noctalia/plugins/desktop-status/pi-activity.ts";

const HELPER = fileURLToPath(
  new URL("../../dot_config/noctalia/plugins/desktop-status/pi-activity.ts", import.meta.url),
);
const STATUS_SCHEMA = Type.Object({
  working: Type.Integer({ minimum: 0 }),
  waiting: Type.Integer({ minimum: 0 }),
  inhibited: Type.Boolean(),
  error: Type.Optional(Type.String()),
});

type FakeInhibitor = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kills: number;
  kill: () => boolean;
};

type MonitorFixture = {
  monitor: ActivityMonitor;
  children: FakeInhibitor[];
  child: (index: number) => FakeInhibitor;
  status: () => ActivityStatus | undefined;
  counts: (value: AgentCounts) => void;
  error: (value: Error | undefined) => void;
};

function fakeInhibitor(): FakeInhibitor {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kills: 0,
    kill(): boolean {
      this.kills += 1;
      return true;
    },
  });
}

function fixture(): MonitorFixture {
  let counts: AgentCounts = { working: 2, waiting: 0 };
  let error: Error | undefined;
  const statuses: ActivityStatus[] = [];
  const children: FakeInhibitor[] = [];
  const monitor = new ActivityMonitor((status) => statuses.push(status), {
    collect: async (): Promise<AgentCounts> => {
      if (error !== undefined) throw error;
      return counts;
    },
    startInhibitor: (): ChildProcessWithoutNullStreams => {
      const child = fakeInhibitor();
      children.push(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });
  return {
    monitor,
    children,
    child: (index) => {
      const child = children[index];
      assert.ok(child, `Expected inhibitor child ${index}`);
      return child;
    },
    status: () => statuses.at(-1),
    counts: (value: AgentCounts) => {
      counts = value;
    },
    error: (value: Error | undefined) => {
      error = value;
    },
  };
}

test("Pi collector counts only live Pi agents with complete, recognized state records", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-collection-test-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const proc = path.join(root, "proc");
  const directory = path.join(root, "accel-os/pi-agents");
  assert.deepEqual(await collectActivity(root, proc), { working: 0, waiting: 0 });
  await mkdir(directory, { recursive: true });
  for (const [pid, state, cmdline] of [
    ["1", "working\n123\n/project\n", "node\0/home/user/accel-os/ai/pi/ai.ts\0"],
    ["2", "idle\n123\n/project\n", "node\0/home/user/accel-os/ai/pi/ai.ts\0"],
    ["3", "working\n", undefined], // Dead PID with a stale state file.
    ["4", "working\n", "unrelated\0process\0"],
    ["5", "working", "/home/user/accel-os/ai/pi/ai.ts\0"],
    ["6", "unknown\n", "/home/user/accel-os/ai/pi/ai.ts\0"],
    ["7", undefined, "/home/user/accel-os/ai/pi/ai.ts\0"], // Vanished state.
  ] as const) {
    if (state !== undefined) await writeFile(path.join(directory, `${pid}.state`), state);
    if (cmdline !== undefined) {
      await mkdir(path.join(proc, pid), { recursive: true });
      await writeFile(path.join(proc, pid, "cmdline"), cmdline);
    }
  }
  // Exercise ENOENT after listing an entry, as when its producer removes it.
  await symlink(path.join(root, "vanished-state"), path.join(directory, "7.state"));
  for (const name of ["notes", "1.state.tmp", "x.state"]) {
    await writeFile(path.join(directory, name), "working\n");
  }
  assert.deepEqual(await collectActivity(root, proc), { working: 1, waiting: 1 });

  // A read error is not a dead process: don't release based on partial counts.
  await rm(path.join(proc, "1/cmdline"));
  await mkdir(path.join(proc, "1/cmdline"));
  await assert.rejects(collectActivity(root, proc), { code: "EISDIR" });
  await rm(directory, { recursive: true });
  await writeFile(directory, "not a directory");
  await assert.rejects(collectActivity(root, proc), { code: "ENOTDIR" });
});

test("Pi monitor keeps one pipe-owned inhibitor until all working agents stop", async (t) => {
  const f = fixture();
  t.after(() => f.monitor.stop());
  await f.monitor.refresh();
  assert.deepEqual(f.status(), { working: 2, waiting: 0, inhibited: false });
  const child = f.child(0);
  const echo: unknown = child.stdin.read();
  assert.ok(Buffer.isBuffer(echo));
  assert.equal(echo.toString(), "ready\n");
  child.stdout.write("ready\n");
  assert.deepEqual(f.status(), { working: 2, waiting: 0, inhibited: true });
  f.counts({ working: 1, waiting: 1 });
  await f.monitor.refresh();
  await f.monitor.refresh();
  assert.equal(f.children.length, 1);
  assert.equal(child.stdin.writableEnded, false);
  f.error(new Error("Permission denied"));
  await f.monitor.refresh();
  assert.deepEqual(f.status(), {
    working: 1,
    waiting: 1,
    inhibited: true,
    error: "Pi activity unavailable: Error: Permission denied",
  });
  f.error(undefined);
  f.counts({ working: 0, waiting: 2 });
  await f.monitor.refresh();
  assert.equal(child.stdin.writableEnded, true);
  assert.equal(child.kills, 0, "Normal release must use EOF, not a signal");
  assert.deepEqual(f.status(), { working: 0, waiting: 2, inhibited: false });

  f.counts({ working: 1, waiting: 0 });
  await f.monitor.refresh();
  assert.equal(f.children.length, 2);
  child.emit("close", 0, null); // Old child callbacks cannot affect a new lease.
  f.child(1).stdout.write("ready\n");
  assert.equal(f.status()?.inhibited, true);
});

test("Pi monitor reports inhibitor exit/errors and retries even if collection is unavailable", async (t) => {
  const f = fixture();
  t.after(() => f.monitor.stop());
  await f.monitor.refresh();
  const child = f.child(0);
  child.stderr.write("Failed to inhibit: Access denied");
  child.emit("close", 7, null);
  assert.equal(f.status()?.inhibited, false);
  assert.match(f.status()?.error ?? "", /Access denied/u);
  await f.monitor.refresh();
  f.child(1).stdout.write("ready\n");
  assert.equal(f.status()?.error, undefined);
  assert.equal(f.status()?.inhibited, true);
  f.child(1).emit("close", null, "SIGKILL");
  assert.match(f.status()?.error ?? "", /SIGKILL/u);
  f.error(new Error("Unavailable"));
  await f.monitor.refresh();
  assert.equal(f.children.length, 3, "Retain the last known working decision");
  f.child(2).stdin.emit("error", new Error("broken pipe"));
  assert.equal(f.status()?.inhibited, false);
  f.error(undefined);
  await f.monitor.refresh();
  f.child(3).emit("error", new Error("spawn failed"));
  assert.match(f.status()?.error ?? "", /spawn failed/u);
  f.counts({ working: 0, waiting: 0 });
  await f.monitor.refresh();
  assert.deepEqual(f.status(), { working: 0, waiting: 0, inhibited: false });
});

test("Pi monitor cancels timed-out and no-longer-needed acquisition", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  t.after(() => f.monitor.stop());
  await f.monitor.refresh();
  t.mock.timers.tick(5000);
  assert.match(f.status()?.error ?? "", /within 5 seconds/u);
  assert.equal(f.child(0).stdin.writableEnded, true);
  assert.equal(f.child(0).kills, 1);
  await f.monitor.refresh();
  f.counts({ working: 0, waiting: 1 });
  await f.monitor.refresh();
  assert.equal(f.child(1).stdin.writableEnded, true);
  assert.equal(f.child(1).kills, 1);
  f.child(1).stdout.write("late readiness\n");
  t.mock.timers.tick(5000);
  assert.deepEqual(f.status(), { working: 0, waiting: 1, inhibited: false });
});

test("Pi monitor serializes collection and cannot acquire after stopping during a read", async () => {
  let complete!: (counts: AgentCounts) => void;
  let reads = 0;
  const monitor = new ActivityMonitor(() => assert.fail("Must not publish after stopping"), {
    collect: async (): Promise<AgentCounts> => {
      reads += 1;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    startInhibitor: (): never => assert.fail("Must not acquire after stopping"),
  });
  const pending = monitor.refresh();
  await monitor.refresh();
  assert.equal(reads, 1);
  monitor.stop();
  complete({ working: 1, waiting: 0 });
  await pending;
  await monitor.refresh();
  assert.equal(reads, 1);
});

for (const signal of ["SIGTERM", "SIGKILL"] as const) {
  test(
    `Pi helper closes its inhibitor pipe on ${signal}, without contacting logind`,
    { skip: process.platform !== "linux", timeout: 10000 },
    async (t) => {
      const directory = await mkdtemp(path.join(tmpdir(), "pi-helper-test-"));
      t.after(async () => {
        await rm(directory, { recursive: true, force: true });
      });
      const agent = spawn(process.execPath, [
        "-e",
        "setInterval(() => {}, 1000)",
        "/test/ai/pi/ai.ts",
      ]);
      const agentExit = once(agent, "exit");
      t.after(async () => {
        agent.kill();
        await agentExit;
      });
      await once(agent, "spawn");
      const stateDir = path.join(directory, "accel-os/pi-agents");
      await mkdir(stateDir, { recursive: true });
      await writeFile(path.join(stateDir, `${agent.pid}.state`), "working\n");
      await writeFile(
        path.join(directory, "systemd-inhibit"),
        await readFile(new URL("./fixtures/fake-systemd-inhibit.sh", import.meta.url)),
        { mode: 0o700 },
      );
      const argsFile = path.join(directory, "args");
      const released = new Promise<void>((resolve) => {
        const watcher = watch(directory, (_event, filename) => {
          if (filename === "args.released") {
            watcher.close();
            resolve();
          }
        });
        t.after(() => watcher.close());
      });
      const helper = spawn(process.execPath, [HELPER], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${directory}:${process.env["PATH"]}`,
          XDG_RUNTIME_DIR: directory,
          INHIBITOR_ARGS: argsFile,
        },
      });
      const helperExit = once(helper, "exit");
      t.after(async () => {
        if (helper.exitCode === null && helper.signalCode === null && helper.pid !== undefined) {
          process.kill(-helper.pid, "SIGKILL");
        }
        await helperExit;
      });
      let diagnostics = "";
      helper.stderr.on("data", (chunk: Buffer) => {
        diagnostics += chunk.toString();
      });
      let ready = false;
      for await (const line of createInterface({ input: helper.stdout })) {
        const status = parseJsonWithSchema(line, STATUS_SCHEMA, "Pi helper status");
        assert.equal(status.working, 1);
        if (status.inhibited) {
          ready = true;
          break;
        }
      }
      assert.ok(ready, diagnostics);
      assert.deepEqual((await readFile(argsFile, "utf8")).trim().split("\n"), [
        "--no-ask-password",
        "--what=idle",
        "--mode=block",
        "--who=noctalia-pi-activity",
        "--why=Pi agents are working",
        "cat",
      ]);
      helper.kill(signal);
      await released; // The fake command records EOF, not a PID-health guess.
      await helperExit;
    },
  );
}
