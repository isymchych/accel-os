import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";

import {
  ImageBlockSchema,
  type ContentBlock,
  type TranscriptMessage,
} from "../../contracts/index.ts";

export type PiMessage = AgentSession["messages"][number];
type PiContent =
  | string
  | readonly (
      | Extract<PiMessage, { role: "assistant" }>["content"][number]
      | Exclude<Extract<PiMessage, { role: "user" }>["content"], string>[number]
    )[];

/** Project SDK content, never provider objects or executable markup, into the client contract. */
export function projectContent(content: PiContent): ContentBlock[] {
  if (typeof content === "string") return textBlock(content);
  return content.flatMap((part): ContentBlock[] => {
    switch (part.type) {
      case "text":
        return textBlock(part.text);
      case "thinking":
        return part.thinking ? [{ type: "thinking", text: part.thinking }] : [];
      case "image":
        return Schema.is(ImageBlockSchema)(part)
          ? [{ type: "image", data: part.data, mimeType: part.mimeType }]
          : [];
      case "toolCall":
        return textBlock(`Tool: ${part.name}\n${JSON.stringify(part.arguments, null, 2)}`);
      default:
        return [];
    }
  });
}
export function textBlock(text: string): ContentBlock[] {
  return text ? [{ type: "text", text }] : [];
}
export function transcriptMessage(message: PiMessage): TranscriptMessage {
  if ("summary" in message)
    return { role: message.role, content: textBlock(message.summary), isError: false };
  if (message.role === "bashExecution")
    return {
      role: message.role,
      content: textBlock(`$ ${message.command}\n${message.output}`),
      isError: message.cancelled || (message.exitCode ?? 0) !== 0,
    };
  return {
    role: message.role,
    content: [
      ...textBlock(message.role === "toolResult" ? `Tool: ${message.toolName}` : ""),
      ...projectContent(message.content),
      ...textBlock(message.role === "assistant" ? (message.errorMessage ?? "") : ""),
    ],
    isError:
      message.role === "toolResult"
        ? message.isError
        : message.role === "assistant" && message.stopReason === "error",
  };
}
// SDK tool event payloads are typed as any; validate that boundary, not the typed session/events.
const ToolResult = Schema.Struct({
  content: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
      ImageBlockSchema,
    ]),
  ),
});
export function toolContent(result: unknown): ContentBlock[] {
  if (!Schema.is(ToolResult)(result))
    return textBlock(result === undefined ? "" : JSON.stringify(result));
  return projectContent(result.content);
}
