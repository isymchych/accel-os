import { isRecord } from "../../shared/guards.ts";

type ToolDefinition = Record<string, unknown>;

const OPENAI_CODEX_NATIVE_WEB_SEARCH_TYPE = "web_search";

function isToolDefinition(value: unknown): value is ToolDefinition {
  return isRecord(value);
}

function isCodexNativeWebSearchTool(tool: ToolDefinition): boolean {
  return tool["type"] === OPENAI_CODEX_NATIVE_WEB_SEARCH_TYPE;
}

function sanitizeTools(tools: readonly unknown[]): {
  changed: boolean;
  tools: ToolDefinition[];
} {
  const sanitized: ToolDefinition[] = [];
  let changed = false;
  let hasNativeWebSearch = false;

  for (const tool of tools) {
    if (!isToolDefinition(tool)) {
      changed = true;
      continue;
    }

    if (isCodexNativeWebSearchTool(tool)) {
      if (hasNativeWebSearch) {
        changed = true;
        continue;
      }

      hasNativeWebSearch = true;
    }

    sanitized.push(tool);
  }

  return { changed, tools: sanitized };
}

export function addCodexNativeWebSearchToPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const tools = Array.isArray(payload["tools"]) ? payload["tools"] : [];
  const sanitized = sanitizeTools(tools);

  if (!sanitized.tools.some(isCodexNativeWebSearchTool)) {
    sanitized.tools.push({
      type: OPENAI_CODEX_NATIVE_WEB_SEARCH_TYPE,
      external_web_access: true,
    });
    sanitized.changed = true;
  }

  if (!sanitized.changed) {
    return payload;
  }

  return {
    ...payload,
    tools: sanitized.tools,
  };
}

export const OPENAI_CODEX_WEB_SEARCH_SECTION = `
## Web Search

Native web search is available in this session.
Use web search when the user asks for current or online information.
Prefer web search over guessing when freshness matters.
`;
