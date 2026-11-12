import { randomUUID } from "node:crypto";
import path from "node:path";

import { Schema } from "effect";

import { ImageBlockSchema, type ContentBlock } from "../contracts/index.ts";
import type {
  HistoryEntryId,
  SessionControls,
  SessionHistory,
  SessionKey,
  SessionSnapshot,
  SessionSummary,
  StoredSession,
  ToolActivity,
  TranscriptMessage,
} from "../contracts/index.ts";
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

const ResultSchema = Schema.Struct({ content: ContentSchema });
function textBlock(text: string): ContentBlock[] {
  return text ? [{ type: "text", text }] : [];
}
function projectContent(content: StaticContent): ContentBlock[] {
  if (typeof content === "string") return textBlock(content);
  return content.flatMap((part): ContentBlock[] => {
    if (Schema.is(ImageBlockSchema)(part))
      return [{ type: "image", data: part.data, mimeType: part.mimeType }];
    if (part.type === "thinking")
      return part.thinking ? [{ type: "thinking", text: part.thinking }] : [];
    if (part.type === "image") return [];
    if (part.type === "toolCall")
      return textBlock(
        `Tool: ${part.name ?? "unknown"}\n${JSON.stringify(part.arguments, null, 2)}`,
      );
    return textBlock(part.text ?? "");
  });
}
type StaticContent = typeof ContentSchema.Type;
function resultContent(result: unknown): ContentBlock[] {
  if (!Schema.is(ResultSchema)(result))
    return textBlock(result === undefined ? "" : JSON.stringify(result));
  return projectContent(result.content);
}
function contentText(content: ContentBlock[]): string {
  return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}
function transcriptMessage(message: PiMessage): TranscriptMessage {
  if ("summary" in message)
    return { role: message.role, content: textBlock(message.summary), isError: false };
  if ("command" in message)
    return {
      role: message.role,
      content: textBlock(`$ ${message.command}\n${message.output}`),
      isError: message.cancelled === true || (message.exitCode ?? 0) !== 0,
    };
  return {
    role: message.role,
    content: [
      ...textBlock(message.toolName ? `Tool: ${message.toolName}` : ""),
      ...projectContent(message.content),
      ...textBlock(message.errorMessage ?? ""),
    ],
    isError: message.isError === true || message.stopReason === "error",
  };
}

/** Owns a session's execution independently of views; coalesces streaming observations. */
export class DesktopSession {
  private readonly rpc: PiRpc;
  private listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private submitting = false;
  private stopping = false;
  private mutating = false;
  private notification: ReturnType<typeof setTimeout> | undefined;
  private streamingBlocks = new Map<number, ContentBlock>();
  private state: SessionSnapshot;

  public constructor(launch: PiLaunch, key?: SessionKey) {
    this.rpc = new PiRpc(launch);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This generated UUID identifies this execution owner.
    const ownerKey = key ?? (randomUUID() as SessionKey);
    this.state = {
      key: ownerKey,
      revision: 0,
      controlsRevision: 0,
      historyRevision: 0,
      connection: "starting",
      execution: "unknown",
      cwd: launch.cwd,
      sessionId: null,
      sessionFile: null,
      name: path.basename(launch.cwd),
      messages: [],
      streaming: [],
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
    if (!Schema.is(StateSchema)(response.data)) throw new Error("Invalid Pi session state");
    const messages = await this.rpc.request("get_messages");
    if (!Schema.is(MessagesSchema)(messages.data)) throw new Error("Invalid Pi message history");
    this.streamingBlocks.clear();
    this.update({
      connection: "connected",
      sessionId: response.data.sessionId,
      sessionFile: response.data.sessionFile ?? null,
      name: response.data.sessionName ?? this.state.name,
      execution: response.data.isStreaming || response.data.isCompacting ? "running" : "idle",
      messages: messages.data.messages.map(transcriptMessage),
      streaming: [],
      tools: [],
      controlsRevision: this.state.controlsRevision + 1,
      historyRevision: this.state.historyRevision + 1,
    });
  }

  public async prompt(
    message: string,
    mode: "prompt" | "steer" | "follow_up" = "prompt",
  ): Promise<string> {
    if (message.trim().length === 0) throw new Error("Enter a message.");
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
      if (!Schema.is(DispositionSchema)(response.data))
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
      this.invalidateControls();
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
      this.invalidateControls();
    }
  }

  public async list(cwd: string): Promise<StoredSession[]> {
    const data = await this.rpc.control("list", cwd);
    if (!Schema.is(CatalogSchema)(data)) throw new Error("Invalid Pi session catalog");
    return [...data];
  }

  public async listAll(): Promise<StoredSession[]> {
    const data = await this.rpc.control("list-all", "");
    if (!Schema.is(CatalogSchema)(data)) throw new Error("Invalid Pi session catalog");
    return [...data];
  }

  public async history(): Promise<SessionHistory> {
    const response = await this.rpc.request("get_entries");
    if (!Schema.is(EntriesSchema)(response.data)) throw new Error("Invalid Pi session history");
    return {
      leafId: response.data.leafId,
      entries: response.data.entries.map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        label: entry.message
          ? `${entry.message.role}: ${contentText(transcriptMessage(entry.message).content).slice(0, 140)}`
          : `${entry.type}: ${entry.summary?.slice(0, 100) ?? entry.id}`,
      })),
    };
  }

  public async navigate(entryId: HistoryEntryId): Promise<string | undefined> {
    return this.mutate(async () => {
      const data = await this.rpc.control("navigate", entryId);
      if (!Schema.is(NavigationSchema)(data)) throw new Error("Invalid Pi navigation result");
      if (data.cancelled) throw new Error("Pi cancelled history navigation.");
      await this.refresh();
      return data.editorText;
    });
  }

  public async fork(entryId: HistoryEntryId): Promise<string> {
    const data = await this.rpc.control("snapshot", entryId);
    if (!Schema.is(PathSchema)(data)) throw new Error("Invalid Pi snapshot result");
    return data.path;
  }

  public async controls(): Promise<SessionControls> {
    const [state, models, levels] = await Promise.all([
      this.rpc.request("get_state"),
      this.rpc.request("get_available_models"),
      this.rpc.request("get_available_thinking_levels"),
    ]);
    if (
      !Schema.is(StateSchema)(state.data) ||
      !Schema.is(ModelsSchema)(models.data) ||
      !Schema.is(LevelsSchema)(levels.data)
    )
      throw new Error("Invalid Pi model controls");
    return {
      models: models.data.models.map(({ provider, id, name }) => ({ provider, id, name })),
      model: state.data.model
        ? { provider: state.data.model.provider, id: state.data.model.id }
        : null,
      thinkingLevel: state.data.thinkingLevel ?? "off",
      levels: [...levels.data.levels],
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
      this.update({
        controlsRevision: this.state.controlsRevision + 1,
        historyRevision: this.state.historyRevision + 1,
      });
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
        if (!this.stopping)
          this.update({
            execution: "idle",
            activity: null,
            controlsRevision: this.state.controlsRevision + 1,
            historyRevision: this.state.historyRevision + 1,
          });
        break;
      case "message_end":
        if (!Schema.is(MessageEndSchema)(record)) throw new Error("Invalid completed message");
        if (record.message.role === "assistant") this.streamingBlocks.clear();
        this.update({
          messages: [...this.state.messages, transcriptMessage(record.message)],
          streaming: record.message.role === "assistant" ? [] : this.state.streaming,
          historyRevision: this.state.historyRevision + 1,
          controlsRevision: this.state.controlsRevision + (record.message.role === "user" ? 1 : 0),
        });
        break;
      case "message_update":
        this.receiveDelta(record);
        break;
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        this.receiveTool(record);
        break;
      case "extension_error":
        if (!Schema.is(ExtensionErrorSchema)(record)) throw new Error("Invalid extension error");
        this.update({ error: `Extension error: ${record.error}` });
        break;
      case "extension_ui_request":
        this.receiveUi(record);
        break;
      default:
        break;
    }
  }

  private receiveDelta(record: PiRecord): void {
    if (!Schema.is(DeltaSchema)(record)) throw new Error("Invalid message update");
    const { type, delta = "", content, contentIndex } = record.assistantMessageEvent;
    const kind = type.startsWith("text_")
      ? "text"
      : type.startsWith("thinking_")
        ? "thinking"
        : null;
    if (!kind || !["_start", "_delta", "_end"].some((suffix) => type.endsWith(suffix))) return;
    const last = [...this.streamingBlocks.keys()].at(-1) ?? -1;
    const index =
      contentIndex ??
      (type.endsWith("_start") || this.streamingBlocks.get(last)?.type !== kind ? last + 1 : last);
    const previous = this.streamingBlocks.get(index);
    const text = type.endsWith("_end")
      ? (content ?? "")
      : `${previous && previous.type !== "image" ? previous.text : ""}${delta}`;
    this.streamingBlocks.set(index, { type: kind, text });
    this.update(
      {
        streaming: [...this.streamingBlocks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, block]) => block),
      },
      true,
    );
  }

  private receiveTool(record: PiRecord): void {
    if (!Schema.is(ToolSchema)(record)) throw new Error("Invalid tool event");
    const previous = this.state.tools.find((tool) => tool.id === record.toolCallId);
    const output = record.result === undefined ? record.partialResult : record.result;
    const tool: ToolActivity = {
      id: record.toolCallId,
      name: record.toolName,
      arguments:
        record.args === undefined
          ? (previous?.arguments ?? "")
          : JSON.stringify(record.args, null, 2),
      content: output === undefined ? (previous?.content ?? []) : resultContent(output),
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
    if (!Schema.is(UiSchema)(record)) throw new Error("Invalid extension UI request");
    if (["select", "confirm", "input", "editor"].includes(record.method)) {
      this.update({
        notice: `Pi requested a ${record.method} dialog. It was cancelled because this dialog is not yet supported.`,
      });
      void this.rpc.cancelDialog(record.id).catch(() => {
        this.update({ error: "Could not cancel the unsupported Pi dialog." });
      });
    } else if (record.method === "notify" && record.message) {
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

  private invalidateControls(): void {
    this.update({ controlsRevision: this.state.controlsRevision + 1 });
  }

  private notify(): void {
    clearTimeout(this.notification);
    this.notification = undefined;
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
