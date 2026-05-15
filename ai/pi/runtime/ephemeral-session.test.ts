import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  createEphemeralSessionFile,
  isManagedEphemeralSessionPath,
  removeEphemeralSessionArtifacts,
} from "./ephemeral-session.ts";
import { isRecord } from "../shared/guards.ts";

function createUserMessage(
  text: string,
  timestamp: number,
): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp,
  };
}

function createAssistantMessage(
  text: string,
  timestamp: number,
): Parameters<SessionManager["appendMessage"]>[0] {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp,
  };
}

async function createTempDir(t: TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => rm(dir, { force: true, recursive: true }));
  return dir;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonLines(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function getMessageEntryId(entry: unknown): string {
  assert.ok(isRecord(entry), "Expected JSONL entry to be an object.");
  const id = entry["id"];
  if (typeof id !== "string") {
    throw new Error("Expected JSONL entry id to be a string.");
  }
  return id;
}

test("createEphemeralSessionFile writes a real branch path to a managed temp file", async (t) => {
  const sourceDir = await createTempDir(t, "pi-ephemeral-source-");
  const tempBaseDir = await createTempDir(t, "pi-ephemeral-base-");
  const sessionManager = SessionManager.create("/workspace/project", sourceDir);

  const rootUserId = sessionManager.appendMessage(createUserMessage("root", 1));
  const assistantId = sessionManager.appendMessage(createAssistantMessage("reply", 2));
  sessionManager.appendMessage(createUserMessage("follow-up", 3));

  const sessionFile = sessionManager.getSessionFile();
  assert.equal(typeof sessionFile, "string", "Expected persisted session to have a session file.");

  const result = await createEphemeralSessionFile({
    sessionManager,
    targetLeafId: assistantId,
    baseDir: tempBaseDir,
  });

  assert.equal(isManagedEphemeralSessionPath(result.sessionFile), true);

  const entries = await readJsonLines(result.sessionFile);
  assert.equal(entries.length, 3);

  const header = entries[0];
  assert.ok(isRecord(header), "Expected session header to be an object.");
  assert.equal(header["type"], "session");
  assert.equal(header["cwd"], "/workspace/project");
  assert.equal(header["parentSession"], sessionFile);

  assert.equal(getMessageEntryId(entries[1]), rootUserId);
  assert.equal(getMessageEntryId(entries[2]), assistantId);
});

test("createEphemeralSessionFile supports root forks with a header-only session", async (t) => {
  const tempBaseDir = await createTempDir(t, "pi-ephemeral-base-");
  const sessionManager = SessionManager.inMemory("/workspace/project");

  sessionManager.appendMessage(createUserMessage("root", 1));
  sessionManager.appendMessage(createAssistantMessage("reply", 2));

  const result = await createEphemeralSessionFile({
    sessionManager,
    targetLeafId: null,
    baseDir: tempBaseDir,
  });

  const entries = await readJsonLines(result.sessionFile);
  assert.equal(entries.length, 1);

  const header = entries[0];
  assert.ok(isRecord(header), "Expected session header to be an object.");
  assert.equal(header["type"], "session");
  assert.equal(header["cwd"], "/workspace/project");
  assert.equal("parentSession" in header, false);
});

test("removeEphemeralSessionArtifacts deletes the managed temp file and directory", async (t) => {
  const tempBaseDir = await createTempDir(t, "pi-ephemeral-base-");
  const sessionManager = SessionManager.inMemory("/workspace/project");
  const userId = sessionManager.appendMessage(createUserMessage("root", 1));

  const result = await createEphemeralSessionFile({
    sessionManager,
    targetLeafId: userId,
    baseDir: tempBaseDir,
  });

  await removeEphemeralSessionArtifacts(result.sessionFile);

  assert.equal(await pathExists(result.sessionFile), false);
  assert.equal(await pathExists(result.sessionDir), false);
});
