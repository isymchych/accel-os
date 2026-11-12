import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Schema } from "effect";

import { listPiAccounts } from "../../src/backend/pi/accounts.ts";
import { startBackend } from "../../src/backend/server.ts";
import { WorkspaceSchema } from "../../src/contracts/index.ts";
import { fakePiOptions, fakeSessionFactory } from "./fixtures/helpers.ts";

test("lists all credential profiles without exposing tokens or changing terminal selection", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-accounts-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const profiles = path.join(root, "profiles");
  const first = path.join(profiles, ".pi-account-first");
  const second = path.join(profiles, ".pi-account-second");
  const pending = path.join(profiles, ".pi-account-new");
  await Promise.all(
    [first, second, pending].map(async (directory) => mkdir(directory, { recursive: true })),
  );
  const token = `header.${Buffer.from(
    JSON.stringify({
      email: "fallback@example.test",
      "https://api.openai.com/profile": { email: "first@example.test" },
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-one",
        chatgpt_plan_type: "pro",
      },
    }),
  ).toString("base64url")}.signature`;
  const active = JSON.stringify({ profile: ".pi-account-second" });
  await Promise.all([
    writeFile(path.join(root, "active-account.json"), active),
    writeFile(
      path.join(first, "auth.json"),
      JSON.stringify({ "openai-codex": { type: "oauth", access: token, refresh: "secret" } }),
    ),
    writeFile(
      path.join(second, "auth.json"),
      JSON.stringify({
        "openai-codex": { type: "oauth", access: "opaque", accountId: "account-two" },
      }),
    ),
  ]);

  const accounts = await listPiAccounts(root);
  assert.deepEqual(accounts, [
    {
      profile: ".pi-account-first",
      accountId: "account-one",
      email: "first@example.test",
      plan: "pro",
    },
    { profile: ".pi-account-second", accountId: "account-two" },
  ]);
  assert.doesNotMatch(JSON.stringify(accounts), /secret|header|signature/u);
  assert.equal(await readFile(path.join(root, "active-account.json"), "utf8"), active);
});

test("missing profiles are empty and invalid profile files fail without exposing their contents", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-accounts-invalid-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listPiAccounts(root), []);
  const profile = path.join(root, "profiles", ".pi-account-invalid");
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, "auth.json"), "secret invalid json");
  await assert.rejects(listPiAccounts(root), {
    message: "Invalid credentials for Pi profile .pi-account-invalid",
  });
});

test("authenticated account selection is shared with observers and leaves terminal selection alone", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-accounts-http-"));
  const profile = path.join(root, "profiles", ".pi-account-first");
  await mkdir(profile, { recursive: true });
  await writeFile(
    path.join(profile, "auth.json"),
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "private-token",
        refresh: "private-refresh",
        accountId: "fixture-account",
      },
    }),
  );
  const second = path.join(root, "profiles", ".pi-account-second");
  await mkdir(second, { recursive: true });
  await writeFile(
    path.join(second, "auth.json"),
    JSON.stringify({ "openai-codex": { type: "oauth", access: "second-secret" } }),
  );
  const terminalSelection = JSON.stringify({ profile: ".pi-account-first" });
  await writeFile(path.join(root, "active-account.json"), terminalSelection);
  const backend = await startBackend({
    pi: fakePiOptions(root),
    sessionFactory: fakeSessionFactory,
    accountConfigDir: root,
    port: 0,
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  t.after(async () => {
    await reader?.cancel();
    await backend.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal((await fetch(`${backend.origin}/api/accounts`)).status, 401);
  const select = (selectedProfile: string, cookie = ""): Promise<Response> =>
    fetch(`${backend.origin}/api/account`, {
      method: "POST",
      headers: { cookie, origin: backend.origin, "content-type": "application/json" },
      body: JSON.stringify({ profile: selectedProfile }),
    });
  assert.equal((await select(".pi-account-second")).status, 401);
  const token = new URLSearchParams(new URL(backend.connectionUrl).hash.slice(1)).get("token");
  assert.ok(token);
  const auth = await fetch(`${backend.origin}/api/auth`, {
    method: "POST",
    headers: {
      origin: backend.origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const cookie = auth.headers.getSetCookie()[0]?.split(";")[0];
  assert.ok(cookie);
  const response = await fetch(`${backend.origin}/api/accounts`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), [
    { profile: ".pi-account-first", accountId: "fixture-account" },
    { profile: ".pi-account-second" },
  ]);
  assert.doesNotMatch(body, /private-token|private-refresh/u);
  const observations = await fetch(`${backend.origin}/api/events`, {
    headers: { cookie },
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(observations.body);
  reader = observations.body.getReader();
  const eventsReader = reader;
  const decoder = new TextDecoder();
  let buffered = "";
  async function nextEvent(): Promise<{ event: string; data: unknown }> {
    while (!buffered.includes("\n\n")) {
      const chunk = await eventsReader.read();
      assert.equal(chunk.done, false);
      buffered += decoder.decode(chunk.value, { stream: true });
    }
    const end = buffered.indexOf("\n\n");
    const record = buffered.slice(0, end);
    buffered = buffered.slice(end + 2);
    const [event, data] = record.split("\n");
    assert.ok(event);
    assert.ok(data);
    return {
      event: event.slice("event: ".length),
      data: JSON.parse(data.slice("data: ".length)),
    };
  }
  const ready = await nextEvent();
  assert.equal(ready.event, "ready");
  assert.ok(Schema.is(WorkspaceSchema)(ready.data));
  assert.equal(ready.data.selectedAccount, ".pi-account-first");
  assert.equal((await select("../invalid", cookie)).status, 400);
  assert.equal((await select(".pi-account-second", cookie)).status, 200);
  let update = await nextEvent();
  while (update.event !== "account") update = await nextEvent();
  assert.deepEqual(update, { event: "account", data: ".pi-account-second" });
  const current = await fetch(`${backend.origin}/api/workspace`, { headers: { cookie } });
  const currentWorkspace: unknown = await current.json();
  assert.ok(Schema.is(WorkspaceSchema)(currentWorkspace));
  assert.equal(currentWorkspace.selectedAccount, ".pi-account-second");
  assert.equal(await readFile(path.join(root, "active-account.json"), "utf8"), terminalSelection);
});
