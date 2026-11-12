import path from "node:path";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";

import {
  SummarySchema,
  type ContentBlock,
  type SessionSnapshot,
  type ToolActivity,
} from "../contracts/index.ts";
import { transcriptMessage, toolContent } from "./pi/presentation.ts";

interface Projection {
  change: Partial<SessionSnapshot>;
  streamingBlocks?: ReadonlyMap<number, ContentBlock>;
  coalesce?: boolean;
  refresh?: boolean;
}

/** Project SDK events without owning execution, timers, subscriptions, or SDK resources. */
// eslint-disable-next-line complexity
export function projectSessionEvent(
  state: SessionSnapshot,
  streamingBlocks: ReadonlyMap<number, ContentBlock>,
  event: AgentSessionEvent,
  identity: { sessionId: string; sessionFile: string | undefined; stopping: boolean },
): Projection | undefined {
  switch (event.type) {
    case "agent_start":
    case "compaction_start":
      return { change: { execution: "running" } };
    case "agent_settled":
      return identity.stopping
        ? undefined
        : {
            change: {
              execution: "idle",
              activity: null,
              controlsRevision: state.controlsRevision + 1,
              historyRevision: state.historyRevision + 1,
            },
          };
    case "message_end":
      if (event.message.role === "custom" && !event.message.display) return undefined;
      return {
        change: {
          sessionId: Schema.decodeUnknownSync(SummarySchema.fields.sessionId)(identity.sessionId),
          sessionFile: identity.sessionFile ?? null,
          messages: [...state.messages, transcriptMessage(event.message)],
          streaming: event.message.role === "assistant" ? [] : state.streaming,
          ...(event.message.role === "assistant" && event.message.errorMessage
            ? { error: event.message.errorMessage }
            : {}),
          historyRevision: state.historyRevision + 1,
          controlsRevision: state.controlsRevision + (event.message.role === "user" ? 1 : 0),
        },
        ...(event.message.role === "assistant" ? { streamingBlocks: new Map() } : {}),
      };
    case "message_update": {
      const delta = event.assistantMessageEvent;
      switch (delta.type) {
        case "text_start":
        case "text_delta":
        case "text_end":
        case "thinking_start":
        case "thinking_delta":
        case "thinking_end": {
          const previous = streamingBlocks.get(delta.contentIndex);
          const text =
            "content" in delta
              ? delta.content
              : `${previous && previous.type !== "image" ? previous.text : ""}${"delta" in delta ? delta.delta : ""}`;
          const blocks = new Map(streamingBlocks);
          blocks.set(delta.contentIndex, {
            type: delta.type.startsWith("text_") ? "text" : "thinking",
            text,
          });
          return {
            change: {
              streaming: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
            },
            streamingBlocks: blocks,
            coalesce: true,
          };
        }
        case "done":
        case "error":
        case "start":
        case "toolcall_delta":
        case "toolcall_end":
        case "toolcall_start":
        default:
          return undefined;
      }
    }
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end": {
      const previous = state.tools.find((tool) => tool.id === event.toolCallId);
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
          event.type === "tool_execution_end" ? (event.isError ? "error" : "completed") : "running",
      };
      const tools = [...state.tools.filter((item) => item.id !== tool.id), tool];
      const active = tools.find((item) => item.state === "running");
      return {
        change: { tools, activity: active ? `Running ${active.name}` : null },
        coalesce: event.type === "tool_execution_update",
      };
    }
    case "queue_update":
    case "thinking_level_changed":
      return { change: { controlsRevision: state.controlsRevision + 1 } };
    case "entry_appended":
      return { change: { historyRevision: state.historyRevision + 1 } };
    case "session_info_changed":
      return { change: { name: event.name ?? path.basename(state.cwd) } };
    case "compaction_end":
      return event.errorMessage
        ? { change: { error: event.errorMessage } }
        : { change: {}, refresh: true };
    case "auto_retry_start":
      return { change: { execution: "running", notice: `Retrying: ${event.errorMessage}` } };
    case "auto_retry_end":
      return event.finalError ? { change: { error: event.finalError } } : undefined;
    case "agent_end":
    case "bash_execution_update":
    case "message_start":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "summarization_retry_scheduled":
    case "turn_end":
    case "turn_start":
    default:
      return undefined;
  }
}
