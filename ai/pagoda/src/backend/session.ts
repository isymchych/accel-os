import { randomUUID } from "node:crypto";
import path from "node:path";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";

import {
  HistorySchema,
  SummarySchema,
  type ContentBlock,
  type HistoryEntryId,
  type SessionControls,
  type SessionHistory,
  type SessionSnapshot,
  type SessionSummary,
  type ToolActivity,
} from "../contracts/index.ts";
import { SessionCatalog } from "./catalog.ts";
import { transcriptMessage, toolContent } from "./pi/presentation.ts";
import { PiSessionOwner, type PiSessionOptions, type PiSessionFactory } from "./pi/session.ts";
import { piUi } from "./pi/ui.ts";

/** One SDK execution owner, independent of requests/views, with coalesced presentation updates. */
export class DesktopSession {
  private readonly catalog: SessionCatalog;
  private sdk: PiSessionOwner | undefined;
  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private submitting = false;
  private stopping = false;
  private mutating = false;
  private notification: ReturnType<typeof setTimeout> | undefined;
  private readonly streamingBlocks = new Map<number, ContentBlock>();
  private state: SessionSnapshot;
  private readonly options: PiSessionOptions;
  private readonly factory: PiSessionFactory | undefined;

  public constructor(options: PiSessionOptions, factory?: PiSessionFactory) {
    this.options = options;
    this.factory = factory;
    this.catalog = new SessionCatalog(options.sessionDir);
    this.state = {
      key: Schema.decodeUnknownSync(SummarySchema.fields.key)(randomUUID()),
      revision: 0,
      controlsRevision: 0,
      historyRevision: 0,
      connection: "starting",
      execution: "unknown",
      cwd: options.cwd,
      sessionId: null,
      sessionFile: null,
      name: path.basename(options.cwd),
      messages: [],
      streaming: [],
      tools: [],
      activity: null,
      error: null,
      notice: null,
    };
  }
  private get owner(): PiSessionOwner {
    if (!this.sdk || this.closing) throw new Error("Pi session is unavailable");
    return this.sdk;
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
  public start(profileDir?: string): Promise<void> {
    if (this.closing) return Promise.reject(new Error("This session is closed"));
    this.starting ??= this.startSession(profileDir).catch((error: unknown) => {
      this.update({
        connection: "disconnected",
        execution: "unknown",
        error: error instanceof Error ? error.message : "Pi session startup failed.",
      });
      throw error;
    });
    return this.starting;
  }
  private async startSession(profileDir?: string): Promise<void> {
    this.sdk = await PiSessionOwner.create(
      {
        ...this.options,
        ...(profileDir ? { profileDir } : {}),
      },
      this.factory,
    );
    try {
      this.sdk.subscribe((event) => {
        this.receive(event);
      });
      await this.sdk.session.bindExtensions({
        mode: "print",
        uiContext: piUi(this.sdk.session.extensionRunner.getUIContext(), (notice) => {
          this.update({ notice });
        }),
        onError: (error) => {
          this.update({ error: `Extension error: ${error.error}` });
        },
      });
      await this.refresh();
    } catch (error) {
      await this.sdk.close();
      throw error;
    }
  }
  public async refresh(): Promise<void> {
    const session = this.owner.session;
    this.streamingBlocks.clear();
    this.update({
      connection: "connected",
      sessionId: Schema.decodeUnknownSync(SummarySchema.fields.sessionId)(session.sessionId),
      sessionFile: session.sessionFile ?? null,
      name: session.sessionManager.getSessionName() ?? this.state.name,
      execution: session.isStreaming || session.isCompacting ? "running" : "idle",
      messages: session.messages
        .filter((message) => message.role !== "custom" || message.display)
        .map(transcriptMessage),
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
      const disposition = await this.owner.prompt(message, mode, (error) => {
        if (!this.closing)
          this.update({
            error: error instanceof Error ? error.message : "Pi execution failed.",
          });
      });
      this.update({ notice: this.state.notice ?? `Input: ${disposition}.` });
      return disposition;
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : "Pi did not accept the input.",
      });
      throw error;
    } finally {
      this.submitting = false;
      this.update({ controlsRevision: this.state.controlsRevision + 1 });
    }
  }
  public async stop(): Promise<void> {
    if (this.stopping || this.state.connection !== "connected") return;
    this.stopping = true;
    this.update({ execution: "stopping" });
    try {
      await this.owner.session.abort();
      this.update({ execution: "idle", activity: null, notice: "Stopped." });
    } catch (error) {
      this.update({ execution: "unknown", error: "Pi has not confirmed cancellation." });
      throw error;
    } finally {
      this.stopping = false;
      this.update({ controlsRevision: this.state.controlsRevision + 1 });
    }
  }
  public async history(): Promise<SessionHistory> {
    const manager = this.owner.session.sessionManager;
    return Schema.decodeUnknownSync(HistorySchema)({
      leafId: manager.getLeafId(),
      entries: manager.getEntries().map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        label:
          entry.type === "message"
            ? `${entry.message.role}: ${transcriptMessage(entry.message)
                .content.flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n")
                .slice(0, 140)}`
            : `${entry.type}: ${"summary" in entry ? entry.summary.slice(0, 100) : entry.id}`,
      })),
    });
  }
  public async navigate(entryId: HistoryEntryId): Promise<string | undefined> {
    return this.mutate(async () => {
      const result = await this.owner.session.navigateTree(entryId, { summarize: false });
      if (result.cancelled) throw new Error("Pi cancelled history navigation.");
      await this.refresh();
      return result.editorText;
    });
  }
  public async fork(entryId: HistoryEntryId): Promise<string> {
    if (!this.state.sessionFile) throw new Error("This session has no persisted history yet");
    return this.catalog.snapshot(this.state.sessionFile, entryId);
  }
  public async controls(): Promise<SessionControls> {
    const session = this.owner.session;
    const models = await session.modelRuntime.getAvailable();
    return {
      models: models.map(({ provider, id, name }) => ({ provider, id, name })),
      model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
      thinkingLevel: session.thinkingLevel,
      levels: session.getAvailableThinkingLevels(),
      pendingMessageCount: session.pendingMessageCount,
    };
  }
  public async model(provider: string, modelId: string): Promise<void> {
    await this.mutate(async () => {
      const model = this.owner.session.modelRuntime.getModel(provider, modelId);
      if (!model) throw new Error("Unknown Pi model");
      await this.owner.session.setModel(model);
    });
  }
  public async thinking(level: string): Promise<void> {
    await this.mutate(async () => {
      const value = this.owner.session.getAvailableThinkingLevels().find((item) => item === level);
      if (!value) throw new Error("Unsupported thinking level");
      this.owner.session.setThinkingLevel(value);
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
    this.closing ??= (async (): Promise<void> => {
      await this.starting?.catch(() => {});
      try {
        await this.sdk?.close();
      } finally {
        clearTimeout(this.notification);
        this.update({ connection: "disconnected", execution: "unknown" });
        this.listeners.clear();
      }
    })();
    return this.closing;
  }
  // SDK events form one projection boundary; unrelated event kinds are deliberately ignored.
  // eslint-disable-next-line complexity
  private receive(event: AgentSessionEvent): void {
    if (this.closing) return;
    switch (event.type) {
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
        if (event.message.role === "custom" && !event.message.display) break;
        if (event.message.role === "assistant") this.streamingBlocks.clear();
        this.update({
          sessionId: Schema.decodeUnknownSync(SummarySchema.fields.sessionId)(
            this.owner.session.sessionId,
          ),
          sessionFile: this.owner.session.sessionFile ?? null,
          messages: [...this.state.messages, transcriptMessage(event.message)],
          streaming: event.message.role === "assistant" ? [] : this.state.streaming,
          ...(event.message.role === "assistant" && event.message.errorMessage
            ? { error: event.message.errorMessage }
            : {}),
          historyRevision: this.state.historyRevision + 1,
          controlsRevision: this.state.controlsRevision + (event.message.role === "user" ? 1 : 0),
        });
        break;
      case "message_update": {
        const delta = event.assistantMessageEvent;
        switch (delta.type) {
          case "text_start":
          case "text_delta":
          case "text_end":
          case "thinking_start":
          case "thinking_delta":
          case "thinking_end": {
            const kind = delta.type.startsWith("text_") ? "text" : "thinking";
            const previous = this.streamingBlocks.get(delta.contentIndex);
            const text =
              "content" in delta
                ? delta.content
                : `${previous && previous.type !== "image" ? previous.text : ""}${"delta" in delta ? delta.delta : ""}`;
            this.streamingBlocks.set(delta.contentIndex, { type: kind, text });
            this.update(
              {
                streaming: [...this.streamingBlocks.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([, block]) => block),
              },
              true,
            );
            break;
          }
          case "done":
          case "error":
          case "start":
          case "toolcall_delta":
          case "toolcall_end":
          case "toolcall_start":
          default:
            break;
        }
        break;
      }
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": {
        const previous = this.state.tools.find((tool) => tool.id === event.toolCallId);
        const output: unknown =
          event.type === "tool_execution_start"
            ? undefined
            : event.type === "tool_execution_update"
              ? event.partialResult
              : event.result;
        const tool: ToolActivity = {
          id: event.toolCallId,
          name: event.toolName,
          arguments:
            event.type === "tool_execution_end"
              ? (previous?.arguments ?? "")
              : JSON.stringify(event.args, null, 2),
          content: output === undefined ? (previous?.content ?? []) : toolContent(output),
          state:
            event.type === "tool_execution_end"
              ? event.isError
                ? "error"
                : "completed"
              : "running",
        };
        const tools = [...this.state.tools.filter((item) => item.id !== tool.id), tool];
        const active = tools.find((item) => item.state === "running");
        this.update(
          { tools, activity: active ? `Running ${active.name}` : null },
          event.type === "tool_execution_update",
        );
        break;
      }
      case "queue_update":
      case "thinking_level_changed":
        this.update({ controlsRevision: this.state.controlsRevision + 1 });
        break;
      case "entry_appended":
        this.update({ historyRevision: this.state.historyRevision + 1 });
        break;
      case "session_info_changed":
        this.update({ name: event.name ?? path.basename(this.state.cwd) });
        break;
      case "compaction_end":
        if (event.errorMessage) this.update({ error: event.errorMessage });
        else
          void this.refresh().catch((error: unknown) => {
            this.update({
              error: error instanceof Error ? error.message : "Could not refresh compacted history",
            });
          });
        break;
      case "auto_retry_start":
        this.update({ execution: "running", notice: `Retrying: ${event.errorMessage}` });
        break;
      case "auto_retry_end":
        if (event.finalError) this.update({ error: event.finalError });
        break;
      case "agent_end":
      case "bash_execution_update":
      case "message_start":
      case "summarization_retry_attempt_start":
      case "summarization_retry_finished":
      case "summarization_retry_scheduled":
      case "turn_end":
      case "turn_start":
      default:
        break;
    }
  }
  private update(change: Partial<SessionSnapshot>, coalesce = false): void {
    this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
    if (coalesce)
      this.notification ??= setTimeout(() => {
        this.notify();
      }, 40);
    else this.notify();
  }
  private notify(): void {
    clearTimeout(this.notification);
    this.notification = undefined;
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
