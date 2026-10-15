import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createSuspendInhibitor, type SuspendInhibitor } from "./suspend-inhibitor.ts";

type FakeChild = {
  process: ChildProcessWithoutNullStreams;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kills: number;
};

type InhibitorFixture = {
  inhibitor: SuspendInhibitor;
  children: FakeChild[];
  child: (index: number) => FakeChild;
  warnings: string[];
  report: (message: string) => void;
};

function fixture(): InhibitorFixture {
  const children: FakeChild[] = [];
  const warnings: string[] = [];
  const report = (message: string): void => {
    warnings.push(message);
  };
  const inhibitor = createSuspendInhibitor({
    platform: "linux",
    spawnProcess() {
      const child: FakeChild = {
        process: new EventEmitter() as ChildProcessWithoutNullStreams,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kills: 0,
      };
      Object.assign(child.process, {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        kill(): boolean {
          child.kills += 1;
          return true;
        },
      });
      children.push(child);
      return child.process;
    },
  });
  return {
    inhibitor,
    children,
    child(index): FakeChild {
      const child = children[index];
      assert.ok(child, "expected inhibitor helper to have been spawned");
      return child;
    },
    warnings,
    report,
  };
}

test("acquisition waits for cat's echo and repeated acquisition shares one helper", async () => {
  const { inhibitor, children, child, warnings, report } = fixture();
  let ready = false;
  const first = inhibitor.acquire(report).then(() => {
    ready = true;
  });
  const second = inhibitor.acquire(report);
  assert.equal(children.length, 1);
  await Promise.resolve();
  assert.equal(ready, false);

  child(0).stdout.write("ready\n");
  await Promise.all([first, second]);
  assert.equal(ready, true);
  inhibitor.release();
  inhibitor.release();
  assert.equal(child(0).stdin.writableEnded, true);
  assert.equal(child(0).kills, 1);
  assert.deepEqual(warnings, []);
});

test("old helper events cannot clear or report errors against a newer lease", async () => {
  const { inhibitor, children, child, warnings, report } = fixture();
  const first = inhibitor.acquire(report);
  inhibitor.release();
  await first;
  const second = inhibitor.acquire(report);
  child(0).process.emit("close", 0, null);
  child(0).process.emit("error", new Error("late error"));
  child(0).stdout.write("ready\n");
  child(1).stdout.write("ready\n");
  await second;
  await inhibitor.acquire(report);
  assert.equal(children.length, 2);
  inhibitor.release();
  assert.equal(child(1).kills, 1);
  assert.deepEqual(warnings, []);
});

test("startup failures resolve acquisition, report once, and permit a later retry", async () => {
  const { inhibitor, child, warnings, report } = fixture();
  const first = inhibitor.acquire(report);
  child(0).process.emit("error", new Error("spawn systemd-inhibit ENOENT"));
  child(0).stdin.emit("error", new Error("EPIPE"));
  child(0).process.emit("close", -2, null);
  await first;
  assert.deepEqual(warnings, ["spawn systemd-inhibit ENOENT"]);

  const second = inhibitor.acquire(report);
  child(1).stdout.write("ready\n");
  await second;
  inhibitor.release();
});

test("an unexpected helper exit reports the backend diagnostic", async () => {
  const { inhibitor, child, warnings, report } = fixture();
  const ready = inhibitor.acquire(report);
  child(0).stdout.write("ready\n");
  await ready;
  child(0).stderr.write("Failed to inhibit: Access denied\n");
  child(0).process.emit("close", 1, null);
  inhibitor.release();
  assert.deepEqual(warnings, ["Failed to inhibit: Access denied"]);
});

test("a hung acquisition is bounded and its helper is stopped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { inhibitor, child, warnings, report } = fixture();
  const ready = inhibitor.acquire(report);
  t.mock.timers.tick(5_000);
  await ready;
  assert.equal(child(0).kills, 1);
  assert.equal(child(0).stdin.writableEnded, true);
  assert.match(warnings.join("\n"), /did not become ready/u);
});

test("non-Linux platforms do not start an inhibitor", async () => {
  const inhibitor = createSuspendInhibitor({
    platform: "darwin",
    spawnProcess() {
      assert.fail("must not spawn a Linux backend");
    },
  });
  await inhibitor.acquire(() => assert.fail("must not warn for an unsupported platform"));
  inhibitor.release();
});
