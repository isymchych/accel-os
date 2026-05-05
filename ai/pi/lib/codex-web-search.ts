import { isRecord } from "./guards.ts";

export type CodexWebSearchMode = "live" | "cached";
export type CodexWebSearchContextSize = "low" | "medium" | "high";

export interface CodexWebSearchParams {
  query: string;
  mode?: CodexWebSearchMode;
  allowed_domains?: string[];
  context_size?: CodexWebSearchContextSize;
}

export interface CodexWebSearchBodyOptions extends CodexWebSearchParams {
  model: string;
}

export interface CodexWebSearchResult {
  responseId?: string;
  text: string;
}

interface CodexResponsesParseState {
  fallbackText: string;
  responseId: string | undefined;
  text: string;
}

export interface ParseCodexResponsesStreamOptions {
  onTextDelta?: (text: string) => void;
}

export const DEFAULT_CODEX_WEB_SEARCH_MODEL = "gpt-5.4";

const TEXT_VERBOSITY = "low";
const RESPONSES_INCLUDE = ["reasoning.encrypted_content"];
const CODEx_WEB_SEARCH_INSTRUCTIONS =
  "Use the web_search tool to answer the user's query with current web information. Return a concise Markdown summary and include source links when available.";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getRecord(
  value: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function normalizeAllowedDomains(domains: readonly string[] | undefined): string[] | undefined {
  if (domains === undefined) {
    return undefined;
  }

  const normalized = domains.map((domain) => domain.trim()).filter((domain) => domain.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function extractMessageText(item: Record<string, unknown> | null): string {
  if (item === null) {
    return "";
  }

  const content = item["content"];
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }

    if (part["type"] === "output_text") {
      const text = readString(part["text"]);
      if (text !== undefined) {
        parts.push(text);
      }
      continue;
    }

    if (part["type"] === "refusal") {
      const refusal = readString(part["refusal"]);
      if (refusal !== undefined) {
        parts.push(refusal);
      }
    }
  }

  return parts.join("");
}

function buildFailureMessage(event: Record<string, unknown>): string {
  const response = getRecord(event, "response");
  const error = getRecord(response, "error");
  const incompleteDetails = getRecord(response, "incomplete_details");

  const errorCode = readString(error?.["code"]);
  const errorMessage = readString(error?.["message"]);
  if (errorCode !== undefined || errorMessage !== undefined) {
    return [errorCode, errorMessage].filter((part) => part !== undefined).join(": ");
  }

  const incompleteReason = readString(incompleteDetails?.["reason"]);
  if (incompleteReason !== undefined) {
    return `incomplete: ${incompleteReason}`;
  }

  return "Codex web search failed without error details.";
}

function parseSseFrame(frame: string): Record<string, unknown> | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) {
      continue;
    }

    dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) {
    return null;
  }

  const payload = dataLines.join("\n");
  if (payload === "[DONE]") {
    return null;
  }

  const parsed: unknown = JSON.parse(payload);
  return isRecord(parsed) ? parsed : null;
}

function processParsedEvent(
  parsed: Record<string, unknown>,
  state: CodexResponsesParseState,
  options: ParseCodexResponsesStreamOptions | undefined,
): void {
  const eventType = readString(parsed["type"]);
  if (eventType === undefined) {
    return;
  }

  switch (eventType) {
    case "response.created": {
      const response = getRecord(parsed, "response");
      state.responseId = readString(response?.["id"]);
      return;
    }
    case "response.output_text.delta": {
      const delta = readString(parsed["delta"]);
      if (delta === undefined) {
        return;
      }

      state.text += delta;
      options?.onTextDelta?.(state.text);
      return;
    }
    case "response.output_item.done": {
      const item = getRecord(parsed, "item");
      if (item?.["type"] !== "message") {
        return;
      }

      const text = extractMessageText(item);
      if (text.length > 0) {
        state.fallbackText += text;
      }
      return;
    }
    case "response.failed": {
      throw new Error(buildFailureMessage(parsed));
    }
    case "error": {
      const code = readString(parsed["code"]);
      const message = readString(parsed["message"]);
      if (code !== undefined || message !== undefined) {
        throw new Error([code, message].filter((part) => part !== undefined).join(": "));
      }
      throw new Error("Codex web search returned an error event.");
    }
    default:
      return;
  }
}

export function resolveCodexWebSearchModel(
  model:
    | {
        id: string;
        provider: string;
      }
    | undefined,
): string {
  if (model?.provider === "openai-codex" && model.id.trim().length > 0) {
    return model.id;
  }

  return DEFAULT_CODEX_WEB_SEARCH_MODEL;
}

export function buildCodexWebSearchBody(
  options: CodexWebSearchBodyOptions,
): Record<string, unknown> {
  const allowedDomains = normalizeAllowedDomains(options.allowed_domains);
  const webSearchTool: Record<string, unknown> = {
    type: "web_search",
    external_web_access: options.mode !== "cached",
  };

  if (allowedDomains !== undefined) {
    webSearchTool["filters"] = {
      allowed_domains: allowedDomains,
    };
  }

  if (options.context_size !== undefined) {
    webSearchTool["search_context_size"] = options.context_size;
  }

  return {
    model: options.model,
    store: false,
    stream: true,
    instructions: CODEx_WEB_SEARCH_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: options.query,
          },
        ],
      },
    ],
    text: {
      verbosity: TEXT_VERBOSITY,
    },
    include: RESPONSES_INCLUDE,
    tool_choice: "auto",
    parallel_tool_calls: true,
    tools: [webSearchTool],
  };
}

export async function parseCodexResponsesStream(
  stream: ReadableStream<Uint8Array>,
  options?: ParseCodexResponsesStreamOptions,
): Promise<CodexWebSearchResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  const state: CodexResponsesParseState = {
    fallbackText: "",
    responseId: undefined,
    text: "",
  };

  const processFrame = (frame: string): void => {
    const parsed = parseSseFrame(frame);
    if (parsed === null) {
      return;
    }

    processParsedEvent(parsed, state, options);
  };

  for await (const value of stream) {
    buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      processFrame(frame);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  const trimmedBuffer = buffer.trim();
  if (trimmedBuffer.length > 0) {
    processFrame(trimmedBuffer);
  }

  const text = state.text.trim().length > 0 ? state.text.trim() : state.fallbackText.trim();
  if (text.length === 0) {
    throw new Error("Codex web search returned no assistant text.");
  }

  return state.responseId === undefined
    ? { text }
    : {
        responseId: state.responseId,
        text,
      };
}
