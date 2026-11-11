import { randomUUID } from "node:crypto";
import path from "node:path";

import { Type } from "typebox";
import { Value } from "typebox/value";

import type {
  SessionControls,
  SessionHistory,
  SessionSnapshot,
  SessionSummary,
  StoredSession,
  ToolActivity,
  TranscriptMessage,
} from "../desktop-api.ts";
import {
  CatalogSchema,
  ContentSchema,
  DeltaSchema,
  DispositionSchema,
  EntriesSchema,
  ExtensionErrorSchema,
  LevelsSchema,
  MessageEndSchema,
  MessagesSchema,
  ModelsSchema,
  NavigationSchema,
  PathSchema,
  StateSchema,
  ToolSchema,
  UiSchema,
  type PiMessage,
  type PiRecord,
} from "./protocol.ts";
import { PiRpc, type PiLaunch } from "./rpc.ts";

const ResultSchema = Type.Object({ content: ContentSchema });
function resultText(result: unknown): string {
  if (!Value.Check(ResultSchema, result)) return result === undefined ? "" : JSON.stringify(result);
  return typeof result.content === "string"
    ? result.content
    : result.content
        .map((part) => part.text ?? (part.type === "image" ? "[Image result]" : ""))
        .join("\n");
}
function transcriptMessage(message: PiMessage): TranscriptMessage {
  if ("summary" in message) return { role: message.role, text: message.summary, isError: false };
  if ("command" in message)
    return {
      role: message.role,
      text: `$ ${message.command}\n${message.output}`,
      isError: message.cancelled === true || (message.exitCode ?? 0) !== 0,
    };
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .map((part) => {
            if (part.type === "toolCall")
              return `Tool: ${part.name ?? "unknown"}\n${JSON.stringify(part.arguments, null, 2)}`;
            if (part.type === "thinking") return part.thinking ? `Thinking:\n${part.thinking}` : "";
            if (part.type === "image") return "[Image content]";
            return part.text ?? "";
          })
          .join("\n");
  return {
    role: message.role,
    text: [message.toolName ? `Tool: ${message.toolName}` : "", content, message.errorMessage]
      .filter((part) => part !== undefined && part.length > 0)
      .join("\n"),
    isError: message.isError === true || message.stopReason === "error",
  };
}

/** Owns execution independently of views; coalesces transient streaming observations. */
export class DesktopSession {
  private readonly rpc: PiRpc;
  private listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private submitting = false;
  private stopping = false;
  private mutating = false;
  private notification: ReturnType<typeof setTimeout> | undefined;
  private state: SessionSnapshot;

  public constructor(launch: PiLaunch, key = randomUUID()) {
    this.rpc = new PiRpc(launch);
    this.state = {
      key,
      revision: 0,
      connection: "starting",
      execution: "unknown",
      cwd: launch.cwd,
      sessionId: null,
      sessionFile: null,
      name: path.basename(launch.cwd),
      messages: [],
      streaming: "",
      tools: [],
      activity: null,
      error: null,
      notice: null,
    };
    this.rpc.subscribe((record) => {
      this.receive(record);
    });
    this.rpc.onExit((error) => {
      this.update({ connection: "disconnected", execution: "unknown", error: error.message });
    });
  }

  public snapshot(): SessionSnapshot {
    return structuredClone(this.state);
  }

  public summary(): SessionSummary {
    const { key, revision, connection, execution, cwd, sessionId, sessionFile, name } = this.state;
    return { key, revision, connection, execution, cwd, sessionId, sessionFile, name };
  }

  public subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async start(): Promise<void> {
    this.rpc.start();
    try {
      await this.refresh();
    } catch (error) {
      await this.rpc.close();
      throw error;
    }
  }

  public async refresh(): Promise<void> {
    const response = await this.rpc.request("get_state");
    if (!Value.Check(StateSchema, response.data)) throw new Error("Invalid Pi session state");
    const messages = await this.rpc.request("get_messages");
    if (!Value.Check(MessagesSchema, messages.data)) throw new Error("Invalid Pi message history");
    this.update({
      connection: "connected",
      sessionId: response.data.sessionId,
      sessionFile: response.data.sessionFile ?? null,
      name: response.data.sessionName ?? this.state.name,
      execution: response.data.isStreaming || response.data.isCompacting ? "running" : "idle",
      messages: messages.data.messages.map(transcriptMessage),
      streaming: "",
      tools: [],
    });
  }

  public async prompt(
    message: string,
    mode: "prompt" | "steer" | "follow_up" = "prompt",
  ): Promise<string> {
    if (
      this.state.connection !== "connected" ||
      this.submitting ||
      this.mutating ||
      this.state.execution === "unknown" ||
      this.state.execution === "stopping" ||
      (mode === "prompt" && this.state.execution !== "idle")
    ) {
      throw new Error("Wait until Pi is connected and ready before sending.");
    }
    this.submitting = true;
    this.update({ error: null, notice: null });
    try {
      // Let Pi decide whether to start or queue at receipt time, not from a stale snapshot.
      const response = await this.rpc.request("prompt", {
        message,
        ...(mode === "prompt"
          ? {}
          : { streamingBehavior: mode === "follow_up" ? "followUp" : "steer" }),
      });
      if (!Value.Check(DispositionSchema, response.data))
        throw new Error("Pi did not confirm how input was handled. Your draft is preserved.");
      this.update({ notice: this.state.notice ?? `Input: ${response.data.disposition}.` });
      return response.data.disposition;
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : "Pi did not accept the input.",
      });
      throw error;
    } finally {
      this.submitting = false;
    }
  }

  public async stop(): Promise<void> {
    if (this.stopping || this.state.connection !== "connected") return;
    this.stopping = true;
    this.update({ execution: "stopping" });
    try {
      await this.rpc.request("abort");
      this.update({ execution: "idle", activity: null, notice: "Stopped." });
    } catch (error) {
      this.update({ execution: "unknown", error: "Pi has not confirmed cancellation." });
      throw error;
    } finally {
      this.stopping = false;
    }
  }

  public async list(cwd: string): Promise<StoredSession[]> {
    const data = await this.rpc.control("list", cwd);
    if (!Value.Check(CatalogSchema, data)) throw new Error("Invalid Pi session catalog");
    return data;
  }

  public async history(): Promise<SessionHistory> {
    const response = await this.rpc.request("get_entries");
    if (!Value.Check(EntriesSchema, response.data)) throw new Error("Invalid Pi session history");
    return {
      leafId: response.data.leafId,
      entries: response.data.entries.map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        label: entry.message
          ? `${entry.message.role}: ${transcriptMessage(entry.message).text.slice(0, 140)}`
          : `${entry.type}: ${entry.summary?.slice(0, 100) ?? entry.id}`,
      })),
    };
  }

  public async navigate(entryId: string): Promise<string | undefined> {
    return this.mutate(async () => {
      const data = await this.rpc.control("navigate", entryId);
      if (!Value.Check(NavigationSchema, data)) throw new Error("Invalid Pi navigation result");
      if (data.cancelled) throw new Error("Pi cancelled history navigation.");
      await this.refresh();
      return data.editorText;
    });
  }

  public async fork(entryId: string): Promise<string> {
    const data = await this.rpc.control("snapshot", entryId);
    if (!Value.Check(PathSchema, data)) throw new Error("Invalid Pi snapshot result");
    return data.path;
  }

  public async controls(): Promise<SessionControls> {
    const [state, models, levels] = await Promise.all([
      this.rpc.request("get_state"),
      this.rpc.request("get_available_models"),
      this.rpc.request("get_available_thinking_levels"),
    ]);
    if (
      !Value.Check(StateSchema, state.data) ||
      !Value.Check(ModelsSchema, models.data) ||
      !Value.Check(LevelsSchema, levels.data)
    )
      throw new Error("Invalid Pi model controls");
    return {
      models: models.data.models.map(({ provider, id, name }) => ({ provider, id, name })),
      model: state.data.model
        ? { provider: state.data.model.provider, id: state.data.model.id }
        : null,
      thinkingLevel: state.data.thinkingLevel ?? "off",
      levels: levels.data.levels,
      pendingMessageCount: state.data.pendingMessageCount ?? 0,
    };
  }

  public async model(provider: string, modelId: string): Promise<void> {
    await this.mutate(async () => {
      await this.rpc.request("set_model", { provider, modelId });
    });
  }
  public async thinking(level: string): Promise<void> {
    await this.mutate(async () => {
      const controls = await this.controls();
      if (!controls.levels.includes(level)) throw new Error("Unsupported thinking level");
      await this.rpc.request("set_thinking_level", { level });
    });
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (
      this.state.connection !== "connected" ||
      this.state.execution !== "idle" ||
      this.submitting ||
      this.mutating
    )
      throw new Error("Wait until Pi is connected and idle.");
    this.mutating = true;
    try {
      return await operation();
    } finally {
      this.mutating = false;
    }
  }

  public async close(): Promise<void> {
    await this.rpc.close();
    clearTimeout(this.notification);
    this.listeners.clear();
  }

  private receive(record: PiRecord): void {
    switch (record.type) {
      case "agent_start":
      case "compaction_start":
        this.update({ execution: "running" });
        break;
      case "agent_settled":
        if (!this.stopping) this.update({ execution: "idle", activity: null });
        break;
      case "message_end":
        if (!Value.Check(MessageEndSchema, record)) throw new Error("Invalid completed message");
        this.update({
          messages: [...this.state.messages, transcriptMessage(record.message)],
          streaming: record.message.role === "assistant" ? "" : this.state.streaming,
        });
        break;
      case "message_update":
        if (!Value.Check(DeltaSchema, record)) throw new Error("Invalid message update");
        if (record.assistantMessageEvent.type === "text_delta") {
          this.update(
            { streaming: this.state.streaming + (record.assistantMessageEvent.delta ?? "") },
            true,
          );
        }
        break;
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        this.receiveTool(record);
        break;
      case "extension_error":
        if (!Value.Check(ExtensionErrorSchema, record)) throw new Error("Invalid extension error");
        this.update({ error: `Extension error: ${record.error}` });
        break;
      case "extension_ui_request":
        this.receiveUi(record);
        break;
      default:
        break;
    }
  }

  private receiveTool(record: PiRecord): void {
    if (!Value.Check(ToolSchema, record)) throw new Error("Invalid tool event");
    const previous = this.state.tools.find((tool) => tool.id === record.toolCallId);
    const output = record.result === undefined ? record.partialResult : record.result;
    const tool: ToolActivity = {
      id: record.toolCallId,
      name: record.toolName,
      arguments:
        record.args === undefined
          ? (previous?.arguments ?? "")
          : JSON.stringify(record.args, null, 2),
      output: output === undefined ? (previous?.output ?? "") : resultText(output),
      state:
        record.type === "tool_execution_end" ? (record.isError ? "error" : "completed") : "running",
    };
    const tools = [...this.state.tools.filter((item) => item.id !== tool.id), tool];
    const active = tools.find((item) => item.state === "running");
    this.update(
      { tools, activity: active ? `Running ${active.name}` : null },
      record.type === "tool_execution_update",
    );
  }

  private receiveUi(record: PiRecord): void {
    if (!Value.Check(UiSchema, record)) throw new Error("Invalid extension UI request");
    if (["select", "confirm", "input", "editor"].includes(record.method)) {
      this.update({
        notice: `Pi requested a ${record.method} dialog. It was cancelled because this dialog is not yet supported.`,
      });
      void this.rpc.cancelDialog(record.id).catch(() => {
        this.update({ error: "Could not cancel the unsupported Pi dialog." });
      });
    } else if (record.method === "notify" && record.message) {
      if (record.message.startsWith("workspace-control:")) return;
      this.update({ notice: record.message });
    }
  }

  private update(change: Partial<SessionSnapshot>, coalesce = false): void {
    this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
    if (coalesce) {
      this.notification ??= setTimeout(() => {
        this.notify();
      }, 40);
    } else this.notify();
  }

  private notify(): void {
    clearTimeout(this.notification);
    this.notification = undefined;
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
