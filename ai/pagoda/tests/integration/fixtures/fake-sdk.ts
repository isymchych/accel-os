import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import {
  createPiSession,
  type PiSessionFactory,
  type PiSessionOptions,
} from "../../../src/backend/pi/session.ts";

type Message = AgentSession["messages"][number];
type Assistant = Extract<Message, { role: "assistant" }>;
const initializations = new Map<string, Promise<void>>();
const image = {
  type: "image" as const,
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==",
};

export function fakePiOptions(directory: string): PiSessionOptions {
  return {
    cwd: directory,
    agentDir: path.join(directory, "agent"),
    profileDir: path.join(directory, "profile"),
    sessionDir: path.join(directory, "native"),
    sharedDir: directory,
  };
}
function assistant(content: Assistant["content"]): Assistant {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "fake",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
async function initialize(options: PiSessionOptions): Promise<void> {
  await Promise.all(
    [options.agentDir, options.profileDir, options.sessionDir].map(async (directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
  await writeFile(path.join(options.sharedDir, "SYSTEM.md"), "Isolated synthetic SDK fixture.");
  await writeFile(
    path.join(options.agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fake: {
          api: "openai-completions",
          apiKey: "synthetic",
          baseUrl: "http://127.0.0.1:1",
          models: [
            {
              id: "fixture",
              name: "Fixture",
              reasoning: true,
              contextWindow: 128000,
              maxTokens: 1000,
            },
            { id: "other", name: "Other", reasoning: true, contextWindow: 128000, maxTokens: 1000 },
          ],
        },
      },
    }),
  );
}

/** Fake execution at the SDK factory seam; native SDK persistence, models, and navigation remain real.
 * These application-wiring fixtures do not establish provider/tool-loop compatibility.
 */
export const fakeSessionFactory: PiSessionFactory = async (options) => {
  let initialized = initializations.get(options.agentDir);
  if (!initialized) {
    initialized = initialize(options);
    initializations.set(options.agentDir, initialized);
  }
  await initialized;
  const session = await createPiSession(options);
  const root = options.sharedDir;
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const subscribe = session.subscribe.bind(session);
  const dispose = session.dispose.bind(session);
  const bind = session.bindExtensions.bind(session);
  let ui: ExtensionUIContext | undefined;
  let running = false;
  let tool: ChildProcess | undefined;
  const queue: string[] = [];
  const emit = (event: AgentSessionEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const message = (
    value: Exclude<Message, { role: "branchSummary" | "compactionSummary" }>,
  ): void => {
    session.sessionManager.appendMessage(value);
    session.refreshContext();
    emit({ type: "message_end", message: value });
  };
  const delta = (text: string): void => {
    const partial = assistant([{ type: "text", text }]);
    emit({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text, partial },
    });
  };
  const stopTool = async (): Promise<void> => {
    if (!tool) return;
    const exited = once(tool, "exit");
    tool.kill("SIGTERM");
    await exited;
    tool = undefined;
  };
  const delay = async (kind: "abort" | "prompt"): Promise<void> => {
    if (
      !(await readFile(path.join(root, `delay-${kind}`)).then(
        () => true,
        () => false,
      ))
    )
      return;
    await unlink(path.join(root, `delay-${kind}`));
    await new Promise<void>((resolve, reject) => {
      const watcher = watch(root, (_event, filename) => {
        if (filename !== `release-${kind}`) return;
        watcher.close();
        resolve();
      });
      watcher.once("error", reject);
      void writeFile(path.join(root, `${kind}-pending`), "pending").catch(reject);
    });
  };
  session.subscribe = (listener) => {
    listeners.add(listener);
    const unsubscribe = subscribe(listener);
    return (): void => {
      listeners.delete(listener);
      unsubscribe();
    };
  };
  session.bindExtensions = async (bindings): Promise<void> => {
    ui = bindings.uiContext;
    await bind(bindings);
  };
  Object.defineProperties(session, {
    isStreaming: { get: (): boolean => running },
    pendingMessageCount: { get: (): number => queue.length },
  });
  // The fixture deliberately combines scenarios behind the SDK's single prompt entry point.
  // eslint-disable-next-line complexity
  session.prompt = async (text, opts): Promise<void> => {
    if (text === "reject") throw new Error("Rejected test prompt");
    if (text === "crash") throw new Error("Synthetic SDK execution failure");
    if (text === "/dialog") {
      const approved = await ui?.confirm("Test dialog", "Approve?");
      if (approved !== false) throw new Error("Expected explicit dialog cancellation");
      opts?.preflightResult?.("handled");
      return;
    }
    if (running && opts?.streamingBehavior) {
      if (text === "__transcript_chunk__") {
        delta(
          "\n\nAnother finding: the draft belongs to its session and must survive navigation.\n\n".repeat(
            4,
          ),
        );
        opts.preflightResult?.("handled");
        return;
      }
      if (text === "__deliver_queued__") {
        const delivered = queue.shift();
        if (!delivered) throw new Error("No queued message");
        message({ role: "user", content: delivered, timestamp: Date.now() });
        opts.preflightResult?.("handled");
        return;
      }
      await appendFile(
        path.join(root, "queue.jsonl"),
        JSON.stringify({
          sessionId: session.sessionId,
          type: opts.streamingBehavior === "followUp" ? "follow_up" : "steer",
          message: text,
        }) + "\n",
      );
      queue.push(text);
      emit({ type: "queue_update", steering: [], followUp: queue });
      opts.preflightResult?.("queued");
      return;
    }
    await appendFile(path.join(root, "prompts.jsonl"), JSON.stringify({ message: text }) + "\n");
    running = true;
    emit({ type: "agent_start" });
    message({ role: "user", content: text, timestamp: Date.now() });
    if (text === "hold") {
      tool = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      await writeFile(path.join(root, "tool-pid"), String(tool.pid));
      emit({
        type: "tool_execution_start",
        toolName: "harmless-wait",
        toolCallId: "test-tool",
        args: { purpose: "wait" },
      });
      emit({
        type: "tool_execution_update",
        toolName: "harmless-wait",
        toolCallId: "test-tool",
        args: {},
        partialResult: { content: [{ type: "text", text: "Waiting for cancellation" }] },
      });
      delta("Working…");
    } else if (text === "transcript-stream") {
      delta(
        `## Investigation\n\n${"Reading the workspace and checking session ownership before changing the renderer.\n\n".repeat(16)}`,
      );
    } else {
      delta("Hello from fake Pi. \u2028 \u2029 ☕");
      if (text === "transcript-demo") {
        for (const [id, name, args, output, isError] of [
          [
            "read-demo",
            "read",
            { path: "src/renderer/session-view.tsx" },
            "Read 120 lines.",
            false,
          ],
          [
            "bash-demo",
            "bash",
            { command: "pnpm run check" },
            "Typecheck failed: missing fixture.\n<img src=x onerror=alert(1)>",
            true,
          ],
        ] as const) {
          emit({ type: "tool_execution_start", toolCallId: id, toolName: name, args });
          emit({
            type: "tool_execution_end",
            toolCallId: id,
            toolName: name,
            isError,
            result: { content: [{ type: "text", text: output }] },
          });
        }
      }
      const content =
        text === "ordered-content"
          ? [
              { type: "text" as const, text: "First text" },
              { type: "thinking" as const, thinking: "Private reasoning" },
              { type: "text" as const, text: "Last text" },
            ]
          : [{ type: "text" as const, text: completedText(text) }];
      message(assistant(content));
      if (text === "ordered-content")
        message({
          role: "toolResult",
          toolCallId: "image-fixture",
          toolName: "image-fixture",
          isError: false,
          content: [
            { type: "text", text: "Before image" },
            image,
            { type: "text", text: "After image" },
          ],
          timestamp: Date.now(),
        });
      emit({ type: "agent_end", messages: session.messages, willRetry: false });
      running = false;
      emit({ type: "agent_settled", aborted: false });
    }
    if (text === "delayed") await delay("prompt");
    opts?.preflightResult?.("started");
  };
  session.abort = async (): Promise<void> => {
    const wasRunning = running;
    await stopTool();
    if (wasRunning) {
      emit({
        type: "tool_execution_end",
        toolName: "harmless-wait",
        toolCallId: "test-tool",
        result: { content: [{ type: "text", text: "Harmless tool terminated" }] },
        isError: false,
      });
      running = false;
      queue.length = 0;
      emit({ type: "agent_settled", aborted: true });
      await delay("abort");
    }
    await writeFile(path.join(root, "closed"), "clean");
  };
  session.dispose = (): void => {
    listeners.clear();
    dispose();
  };
  const model = session.modelRuntime.getModel("fake", "fixture");
  if (!model) throw new Error("Fixture model was not registered");
  await session.setModel(model);
  session.setThinkingLevel("off");
  return session;
};
function completedText(text: string): string {
  if (text === "long-output") return `Large output\n${"x".repeat(50000)}\nEND_OF_LONG_OUTPUT`;
  if (text !== "transcript-demo") return "Hello from fake Pi.";
  return [
    "## Workspace review",
    "Keep **session ownership** explicit and preserve `drafts`.",
    "- Read configuration\n- Verify behavior",
    `\`\`\`ts\nconst path = "${"long-path/".repeat(35)}";\n\`\`\``,
    "| Check | Result |\n| --- | --- |\n| Draft | Preserved |",
    "[Documentation](https://example.com/docs)",
    "[Unsafe link](javascript:alert%281%29)",
    "![Remote image](https://example.com/private.png)",
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
  ].join("\n\n");
}
