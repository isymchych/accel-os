import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

import { executeShellTool } from "./index.ts";

test("shell execution honors per-call cwd without changing the session cwd", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "pi-shell-cwd-")));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const sessionCwd = path.join(root, "session");
  const snapshotCwd = path.join(root, "snapshot");
  await Promise.all([mkdir(sessionCwd), mkdir(snapshotCwd)]);
  const ctx = {
    cwd: sessionCwd,
    sessionManager: {
      getSessionId: () => "shell-cwd-test",
      getSessionFile: () => undefined,
    },
  } as unknown as ExtensionToolContext;

  for (const [name, cwd, expected] of [
    ["absolute", snapshotCwd, snapshotCwd],
    ["relative", "../snapshot", snapshotCwd],
    ["default", undefined, sessionCwd],
  ] as const) {
    await t.test(name, async () => {
      const result = await executeShellTool(
        `cwd-${name}`,
        { command: "pwd -P", ...(cwd === undefined ? {} : { cwd }) },
        undefined,
        undefined,
        ctx,
      );
      assert.deepEqual(result.content, [{ type: "text", text: `${expected}\n` }]);
      assert.equal(ctx.cwd, sessionCwd);
    });
  }
});
