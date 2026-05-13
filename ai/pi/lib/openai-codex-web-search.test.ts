import assert from "node:assert/strict";
import test from "node:test";

import {
  addCodexNativeWebSearchToPayload,
  OPENAI_CODEX_WEB_SEARCH_SECTION,
} from "./openai-codex-web-search.ts";

test("addCodexNativeWebSearchToPayload appends native web search", () => {
  assert.deepEqual(
    addCodexNativeWebSearchToPayload({
      model: "gpt-5.4",
      tools: [
        {
          type: "function",
          name: "read",
        },
      ],
    }),
    {
      model: "gpt-5.4",
      tools: [
        {
          type: "function",
          name: "read",
        },
        {
          type: "web_search",
          external_web_access: true,
        },
      ],
    },
  );
});

test("addCodexNativeWebSearchToPayload does not duplicate native web search", () => {
  const payload = {
    model: "gpt-5.4",
    tools: [
      {
        type: "function",
        name: "read",
      },
      {
        type: "web_search",
        external_web_access: true,
      },
    ],
  };

  assert.equal(addCodexNativeWebSearchToPayload(payload), payload);
});

test("addCodexNativeWebSearchToPayload removes duplicate native web search tools", () => {
  assert.deepEqual(
    addCodexNativeWebSearchToPayload({
      model: "gpt-5.4",
      tools: [
        {
          type: "web_search",
          external_web_access: true,
        },
        {
          type: "web_search",
          external_web_access: false,
        },
      ],
    }),
    {
      model: "gpt-5.4",
      tools: [
        {
          type: "web_search",
          external_web_access: true,
        },
      ],
    },
  );
});

test("addCodexNativeWebSearchToPayload replaces missing tools with native web search", () => {
  assert.deepEqual(addCodexNativeWebSearchToPayload({ model: "gpt-5.4" }), {
    model: "gpt-5.4",
    tools: [
      {
        type: "web_search",
        external_web_access: true,
      },
    ],
  });
});

test("OPENAI_CODEX_WEB_SEARCH_SECTION mentions native web search availability", () => {
  assert.match(OPENAI_CODEX_WEB_SEARCH_SECTION, /Native web search is available/);
  assert.match(OPENAI_CODEX_WEB_SEARCH_SECTION, /Use web search/);
});
