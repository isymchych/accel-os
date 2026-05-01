import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexWebSearchBody,
  parseCodexResponsesStream,
  resolveCodexWebSearchModel,
} from "./codex-web-search.ts";

function streamFromChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(chunk));
      index += 1;
    },
  });
}

test("buildCodexWebSearchBody maps codex-native search options", () => {
  assert.deepEqual(
    buildCodexWebSearchBody({
      model: "gpt-5.4",
      query: "latest openai news",
      mode: "cached",
      allowed_domains: [" example.com ", "", "openai.com"],
      context_size: "high",
    }),
    {
      model: "gpt-5.4",
      store: false,
      stream: true,
      instructions:
        "Use the web_search tool to answer the user's query with current web information. Return a concise Markdown summary and include source links when available.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "latest openai news" }],
        },
      ],
      text: { verbosity: "low" },
      include: ["reasoning.encrypted_content"],
      tool_choice: "auto",
      parallel_tool_calls: true,
      tools: [
        {
          type: "web_search",
          external_web_access: false,
          filters: { allowed_domains: ["example.com", "openai.com"] },
          search_context_size: "high",
        },
      ],
    },
  );
});

test("resolveCodexWebSearchModel prefers the active codex model", () => {
  assert.equal(
    resolveCodexWebSearchModel({ provider: "openai-codex", id: "gpt-5.4-mini" }),
    "gpt-5.4-mini",
  );
  assert.equal(
    resolveCodexWebSearchModel({ provider: "anthropic", id: "claude-sonnet-4-5" }),
    "gpt-5.4",
  );
  assert.equal(resolveCodexWebSearchModel(undefined), "gpt-5.4");
});

test("parseCodexResponsesStream accumulates streamed text deltas", async () => {
  const partials: string[] = [];
  const result = await parseCodexResponsesStream(
    streamFromChunks([
      'data: {"type":"response.created","response":{"id":"resp-1"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    ]),
    {
      onTextDelta: (text) => {
        partials.push(text);
      },
    },
  );

  assert.deepEqual(partials, ["Hello", "Hello world"]);
  assert.deepEqual(result, {
    responseId: "resp-1",
    text: "Hello world",
  });
});

test("parseCodexResponsesStream falls back to completed message content", async () => {
  const result = await parseCodexResponsesStream(
    streamFromChunks([
      'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"Final answer"}]}}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    ]),
  );

  assert.deepEqual(result, {
    text: "Final answer",
  });
});

test("parseCodexResponsesStream surfaces failed responses", async () => {
  await assert.rejects(
    async () =>
      parseCodexResponsesStream(
        streamFromChunks([
          'data: {"type":"response.failed","response":{"error":{"code":"rate_limit","message":"Too many requests"}}}\n\n',
        ]),
      ),
    /rate_limit: Too many requests/,
  );
});
