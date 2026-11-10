import { Value } from "typebox/value";

import type { SessionSnapshot, TranscriptMessage } from "../contracts/desktop.ts";
import {
  DeltaSchema,
  ExtensionErrorSchema,
  MessageEndSchema,
  MessagesSchema,
  StateSchema,
  ToolSchema,
  UiSchema,
  type PiMessage,
  type PiRecord,
} from "./protocol.ts";
import { PiRpc, type PiLaunch } from "./rpc.ts";

function transcriptMessage(message: PiMessage): TranscriptMessage {
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
  return {
    role: message.role,
    text: [content, message.errorMessage]
      .filter((part) => part !== undefined && part.length > 0)
      .join("\n"),
    isError: message.isError === true || message.stopReason === "error",
  };
}

/** Owns execution independently of renderer lifetimes; Pi owns persisted history. */
export class DesktopSession {
  private readonly rpc: PiRpc;
  private listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private submitting = false;
  private stopping = false;
  private state: SessionSnapshot;

  public constructor(launch: PiLaunch) {
    this.rpc = new PiRpc(launch);
    this.state = {
      revision: 0,
      connection: "starting",
      execution: "unknown",
      cwd: launch.cwd,
      sessionId: null,
      messages: [],
      streaming: "",
      activity: null,
      error: null,
      notice: null,
    };
    this.rpc.subscribe((record) => this.receive(record));
    this.rpc.onExit((error) => {
      this.update({ connection: "disconnected", execution: "unknown", error: error.message });
    });
  }

  public snapshot(): SessionSnapshot {
    return structuredClone(this.state);
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
      const response = await this.rpc.request("get_state");
      if (!Value.Check(StateSchema, response.data)) throw new Error("Invalid Pi session state");
      const messages = await this.rpc.request("get_messages");
      if (!Value.Check(MessagesSchema, messages.data))
        throw new Error("Invalid Pi message history");
      this.update({
        connection: "connected",
        sessionId: response.data.sessionId,
        execution: response.data.isStreaming || response.data.isCompacting ? "running" : "idle",
        messages: messages.data.messages.map(transcriptMessage),
      });
    } catch (error) {
      await this.rpc.close();
      throw error;
    }
  }

  public async prompt(message: string): Promise<void> {
    if (
      this.state.connection !== "connected" ||
      this.state.execution !== "idle" ||
      this.submitting
    ) {
      throw new Error("Wait until Pi is connected and idle before sending.");
    }
    this.submitting = true;
    this.update({ error: null, notice: null });
    try {
      await this.rpc.request("prompt", { message });
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

  public async close(): Promise<void> {
    await this.rpc.close();
    this.listeners.clear();
  }

  private receive(record: PiRecord): void {
    switch (record.type) {
      case "agent_start":
      case "compaction_start":
        this.update({ execution: "running" });
        break;
      case "agent_settled":
        this.update({ execution: "idle", activity: null });
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
          this.update({
            streaming: this.state.streaming + (record.assistantMessageEvent.delta ?? ""),
          });
        }
        break;
      case "tool_execution_start":
        if (!Value.Check(ToolSchema, record)) throw new Error("Invalid tool event");
        this.update({ activity: `Running ${record.toolName}` });
        break;
      case "tool_execution_end":
        this.update({ activity: null });
        break;
      case "extension_error":
        if (!Value.Check(ExtensionErrorSchema, record)) throw new Error("Invalid extension error");
        this.update({ error: record.error });
        break;
      case "extension_ui_request":
        this.receiveUi(record);
        break;
      default:
        break;
    }
  }

  private receiveUi(record: PiRecord): void {
    if (!Value.Check(UiSchema, record)) throw new Error("Invalid extension UI request");
    if (["select", "confirm", "input", "editor"].includes(record.method)) {
      // Until graphical dialogs exist, cancel explicitly; never silently approve or hang.
      this.update({
        notice: `Pi requested a ${record.method} dialog. This foundation cancels unsupported dialogs.`,
      });
      void this.rpc.cancelDialog(record.id).catch(() => {
        this.update({ error: "Could not cancel the unsupported Pi dialog." });
      });
    } else if (record.method === "notify" && record.message) {
      this.update({ notice: record.message });
    }
  }

  private update(change: Partial<SessionSnapshot>): void {
    this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener(this.snapshot());
  }
}
