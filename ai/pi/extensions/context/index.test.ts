import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import contextExtension from "./index.ts";

test("context prompt uses the final prompt from the last completed turn", async () => {
  const handlers = new Map<string, (event: never, ctx: never) => void>();
  let commandHandler: ((args: string, ctx: never) => Promise<void>) | undefined;
  const assistantEntry = {
    id: "assistant-1",
    type: "message",
    message: { role: "assistant" },
  };
  const pi = {
    on(event: string, handler: (event: never, ctx: never) => void) {
      handlers.set(event, handler);
      return () => {};
    },
    registerCommand(
      _name: string,
      command: { handler: (args: string, ctx: never) => Promise<void> },
    ) {
      commandHandler = command.handler;
    },
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;

  contextExtension(pi);

  const promptOptions = {
    cwd: "/repo",
    contextFiles: [{ path: "/repo/AGENTS.md", content: "base rules" }],
  };
  handlers.get("before_agent_start")?.(
    { systemPromptOptions: promptOptions } as never,
    undefined as never,
  );
  promptOptions.contextFiles?.push({ path: "/repo/LOCAL.md", content: "turn rules" });
  handlers.get("agent_start")?.(
    undefined as never,
    { getSystemPrompt: () => "effective prompt" } as never,
  );
  handlers.get("agent_settled")?.(
    undefined as never,
    {
      sessionManager: {
        getBranch: () => [assistantEntry],
      },
    } as never,
  );

  let shownPrompt: string | undefined;
  await commandHandler?.("prompt", {
    waitForIdle: async () => {},
    getSystemPrompt: () => "base prompt",
    getSystemPromptOptions: () => ({ cwd: "/repo" }),
    getContextUsage: () => ({ tokens: 100, contextWindow: 1_000, percent: 10 }),
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [assistantEntry],
      getLeafId: () => undefined,
    },
    ui: {
      editor: async (_title: string, value: string) => {
        shownPrompt = value;
      },
    },
  } as never);

  assert.equal(shownPrompt, "effective prompt");

  const differentAssistantEntry = {
    ...assistantEntry,
    id: "assistant-2",
  };
  await commandHandler?.("prompt", {
    waitForIdle: async () => {},
    getSystemPrompt: () => "base prompt",
    getSystemPromptOptions: () => ({ cwd: "/repo" }),
    getContextUsage: () => ({ tokens: 100, contextWindow: 1_000, percent: 10 }),
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [differentAssistantEntry],
      getLeafId: () => undefined,
    },
    ui: {
      editor: async (_title: string, value: string) => {
        shownPrompt = value;
      },
    },
  } as never);

  assert.equal(shownPrompt, "base prompt");
});
