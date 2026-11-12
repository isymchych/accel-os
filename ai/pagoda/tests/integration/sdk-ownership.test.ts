import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DesktopSession } from "../../src/backend/session.ts";
import { fakePiOptions, fakeSessionFactory } from "./fixtures/helpers.ts";

test("shutdown during SDK acquisition releases the acquired owner before completing", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-acquisition-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const acquired = Promise.withResolvers<undefined>();
  const session = new DesktopSession(fakePiOptions(root), async (options) => {
    await acquired.promise;
    return fakeSessionFactory(options);
  });
  const starting = assert.rejects(session.start(), /unavailable/u);
  const closing = session.close();
  acquired.resolve(undefined);
  await Promise.all([starting, closing]);
  assert.equal(await readFile(path.join(root, "closed"), "utf8"), "clean");
  assert.equal(session.snapshot().connection, "disconnected");
  await session.close();
  await assert.rejects(session.start(), /closed/u);
});
test("acquisition failure and binding failure release their owner and expose startup errors", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-failure-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const failed = new DesktopSession(fakePiOptions(root), async () => {
    throw new Error("acquire failed");
  });
  await assert.rejects(failed.start(), /acquire failed/u);
  assert.equal(failed.snapshot().connection, "disconnected");
  assert.equal(failed.snapshot().error, "acquire failed");
  await failed.close();
  const binding = new DesktopSession(fakePiOptions(root), async (options) => {
    const sdk = await fakeSessionFactory(options);
    sdk.bindExtensions = async (): Promise<void> => {
      throw new Error("bind failed");
    };
    return sdk;
  });
  await assert.rejects(binding.start(), /bind failed/u);
  assert.equal(await readFile(path.join(root, "closed"), "utf8"), "clean");
  await binding.close();
});
