import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

import { createAutocompleteProvider } from "../extensions/fuzzy-at-file-autocomplete.ts";

function createCurrentProvider(
  getSuggestions: AutocompleteProvider["getSuggestions"],
): AutocompleteProvider {
  return {
    getSuggestions,
    applyCompletion(lines, cursorLine, cursorCol, _item: AutocompleteItem, _prefix: string) {
      return { lines, cursorLine, cursorCol };
    },
    shouldTriggerFileCompletion() {
      return true;
    },
  };
}

function createExecApi(): Pick<ExtensionAPI, "exec"> {
  return {
    async exec(command, args) {
      assert.equal(command, "fd");
      const typeFlagIndex = args.indexOf("--type");
      assert.notEqual(typeFlagIndex, -1);
      const type = args[typeFlagIndex + 1];

      return {
        stdout: type === "f" ? "file.txt\n" : "",
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  };
}

test("createAutocompleteProvider dismisses owned @ suggestions before delegating", async () => {
  let delegatedCalls = 0;
  const delegatedSuggestion: AutocompleteSuggestions = {
    items: [{ value: "file.txt", label: "file.txt" }],
    prefix: "f",
  };
  const current = createCurrentProvider(async () => {
    delegatedCalls += 1;
    return delegatedSuggestion;
  });
  const provider = createAutocompleteProvider(current, createExecApi(), process.cwd());
  const signal = new AbortController().signal;

  const atSuggestions = await provider.getSuggestions(["@f"], 0, 2, { signal, force: true });
  assert.deepEqual(atSuggestions, {
    items: [{ value: "@file.txt", label: "file.txt", description: "file.txt" }],
    prefix: "@f",
  });

  const dismissedSuggestions = await provider.getSuggestions(["f"], 0, 1, { signal, force: true });
  assert.equal(dismissedSuggestions, null);
  assert.equal(delegatedCalls, 0);

  const delegatedSuggestions = await provider.getSuggestions(["f"], 0, 1, { signal, force: true });
  assert.deepEqual(delegatedSuggestions, delegatedSuggestion);
  assert.equal(delegatedCalls, 1);
});

test("createAutocompleteProvider delegates immediately when no @ suggestions were active", async () => {
  let delegatedCalls = 0;
  const delegatedSuggestion: AutocompleteSuggestions = {
    items: [{ value: "./", label: "./" }],
    prefix: "",
  };
  const current = createCurrentProvider(async () => {
    delegatedCalls += 1;
    return delegatedSuggestion;
  });
  const provider = createAutocompleteProvider(current, createExecApi(), process.cwd());

  const suggestions = await provider.getSuggestions(["f"], 0, 1, {
    signal: new AbortController().signal,
    force: true,
  });

  assert.deepEqual(suggestions, delegatedSuggestion);
  assert.equal(delegatedCalls, 1);
});
