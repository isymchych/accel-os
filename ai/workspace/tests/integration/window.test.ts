import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

test("closing the native window detaches observation before Pi exits", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-window-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      path.resolve(import.meta.dirname, "fixtures/desktop-lifecycle.ts"),
    ],
    {
      timeout: 15_000,
      env: {
        HOME: directory,
        AI_UI_CWD: directory,
        AI_UI_NODE: process.execPath,
        AI_UI_PI_ENTRY: path.resolve(import.meta.dirname, "fixtures/fake-pi.ts"),
        FAKE_PI_STATE: directory,
      },
    },
  );
  assert.doesNotMatch(result.stderr, /Object has been destroyed|Could not close Pi cleanly/);
  assert.equal(await readFile(path.join(directory, "closed"), "utf8"), "clean");
});
