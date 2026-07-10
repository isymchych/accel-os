import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VERBOSITY_BY_MODEL,
  applyVerbosityToOpenAIResponsesPayload,
  describePersistedVerbosityState,
  getVerbositySelections,
  readPersistedVerbosityState,
  resolveOpenAICodexVerbosity,
} from "./verbosity.ts";

test("DEFAULT_VERBOSITY_BY_MODEL matches the known Codex defaults", () => {
  assert.deepEqual(DEFAULT_VERBOSITY_BY_MODEL, {
    "gpt-5.5": "low",
    "gpt-5.4": "low",
    "gpt-5.4-mini": "medium",
    "gpt-5.3-codex": "low",
    "gpt-5.2": "low",
    "codex-auto-review": "low",
  });
});

test("resolveOpenAICodexVerbosity prefers the session override", () => {
  assert.equal(resolveOpenAICodexVerbosity("gpt-5.4-mini", undefined), "medium");
  assert.equal(resolveOpenAICodexVerbosity("gpt-5.4-mini", "high"), "high");
  assert.equal(resolveOpenAICodexVerbosity("unknown-model", undefined), undefined);
});

test("applyVerbosityToOpenAIResponsesPayload preserves other text controls", () => {
  assert.deepEqual(
    applyVerbosityToOpenAIResponsesPayload(
      {
        model: "gpt-5.4-mini",
        text: { format: { type: "json_schema" } },
      },
      "high",
    ),
    {
      model: "gpt-5.4-mini",
      text: {
        format: { type: "json_schema" },
        verbosity: "high",
      },
    },
  );

  assert.deepEqual(applyVerbosityToOpenAIResponsesPayload({ model: "gpt-5.4" }, "low"), {
    model: "gpt-5.4",
    text: { verbosity: "low" },
  });

  assert.equal(applyVerbosityToOpenAIResponsesPayload(null, "low"), undefined);
});

test("readPersistedVerbosityState and getVerbositySelections handle supported values", () => {
  assert.equal(readPersistedVerbosityState({ level: "low" }), "low");
  assert.equal(readPersistedVerbosityState({ level: null }), null);
  assert.equal(readPersistedVerbosityState({ level: "loud" }), undefined);
  assert.deepEqual(getVerbositySelections(), ["low", "medium", "high", "default"]);
});

test("describePersistedVerbosityState formats display-only transcript entries", () => {
  assert.equal(
    describePersistedVerbosityState({ level: "high" }),
    "OpenAI Codex verbosity set to high",
  );
  assert.equal(
    describePersistedVerbosityState({ level: null }),
    "OpenAI Codex verbosity reset to model default",
  );
  assert.equal(describePersistedVerbosityState({ level: "loud" }), undefined);
});
