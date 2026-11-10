import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

import {
  buildMbPreviewArgs,
  collectAssistantPreviewResponses,
  runMbPreview,
  type PreviewChild,
  type PreviewSpawn,
} from "./index.ts";

type AssistantMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;
type AssistantContent = AssistantMessage["content"];

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

class FakePreviewChild extends EventEmitter implements PreviewChild {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
}

function assistantEntry(id: string, content: AssistantContent): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content,
      api: "openai",
      provider: "openai",
      model: "gpt-test",
      usage,
      stopReason: "stop",
      timestamp: 0,
    },
  };
}

function userEntry(id: string): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: "hello", timestamp: 0 },
  };
}

test("collectAssistantPreviewResponses joins text blocks and ignores non-previewable entries", () => {
  const entries: SessionEntry[] = [
    userEntry("u1"),
    assistantEntry("a1", [
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "# First answer\n\nbody" },
      { type: "text", text: "second block" },
    ]),
    assistantEntry("a2", [{ type: "text", text: "   " }]),
    assistantEntry("a3", [{ type: "text", text: "Final answer" }]),
  ];

  const responses = collectAssistantPreviewResponses(entries);

  assert.deepEqual(responses, [
    {
      index: 1,
      title: "Pi response 1",
      markdown: "# First answer\n\nbody\n\nsecond block",
      preview: "First answer",
    },
    {
      index: 2,
      title: "Pi response 2",
      markdown: "Final answer",
      preview: "Final answer",
    },
  ]);
});

test("buildMbPreviewArgs opens with title and current cwd as base dir", () => {
  assert.deepEqual(buildMbPreviewArgs({ title: "Pi response 2", cwd: "/repo" }), [
    "--open",
    "--title",
    "Pi response 2",
    "--base-dir",
    "/repo",
  ]);
});

test("runMbPreview spawns mb-preview and writes markdown to stdin", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string; stdin: string }> = [];

  const spawnPreview: PreviewSpawn = (command, args, options) => {
    const child = new FakePreviewChild();
    let stdin = "";
    child.stdin.on("data", (chunk) => {
      stdin += String(chunk);
    });
    child.stdin.on("finish", () => {
      calls.push({ command, args, cwd: options.cwd, stdin });
      child.stdout.end("/tmp/preview.html\n");
      child.stderr.end();
      queueMicrotask(() => {
        child.emit("close", 0, null);
      });
    });
    return child;
  };

  await runMbPreview("# hello", { title: "Pi response 1", cwd: "/repo" }, spawnPreview);

  assert.deepEqual(calls, [
    {
      command: "mb-preview",
      args: ["--open", "--title", "Pi response 1", "--base-dir", "/repo"],
      cwd: "/repo",
      stdin: "# hello",
    },
  ]);
});

test("runMbPreview rejects non-zero mb-preview exits with stderr", async () => {
  const spawnPreview: PreviewSpawn = () => {
    const child = new FakePreviewChild();
    child.stdin.on("finish", () => {
      child.stderr.end("boom\n");
      queueMicrotask(() => {
        child.emit("close", 1, null);
      });
    });
    return child;
  };

  await assert.rejects(
    async () => runMbPreview("# hello", { title: "Pi response 1", cwd: "/repo" }, spawnPreview),
    /mb-preview failed: boom/u,
  );
});
