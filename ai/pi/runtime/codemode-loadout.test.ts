import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseJsonWithSchema } from "@accel-os/shared/json";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createCodemodeExtension,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ToolDefinition,
  type ToolLoadout,
  type ToolLoadoutChanges,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import applyPatchExtension from "../extensions/apply-patch/index.ts";
import askUserQuestionExtension from "../extensions/ask-user-question/index.ts";
import readToolExtension from "../extensions/read-tool/index.ts";
import shellToolExtension from "../extensions/shell-tool/index.ts";
import srcwalkCliExtension from "../extensions/srcwalk-cli/index.ts";
import tilthCliExtension from "../extensions/tilth-cli/index.ts";
import writeFileExtension from "../extensions/write-file/index.ts";
import type { CodeNavigationBackend } from "./launcher-args.ts";

const loadoutCases = [
  {
    backend: "srcwalk",
    inlineNames: ["read", "bash", "apply_patch", "write_file", "srcwalk_discover", "srcwalk_read"],
    deferredNames: [
      "srcwalk_context",
      "srcwalk_callers",
      "srcwalk_callees",
      "srcwalk_deps",
      "srcwalk_overview",
      "srcwalk_assess",
      "srcwalk_compare",
      "srcwalk_review",
    ],
    descriptionPattern: /callers.*callees.*dependencies.*review/i,
    reviewHintPattern: /srcwalk_review for structural change review/,
  },
  {
    backend: "tilth",
    inlineNames: [
      "read",
      "bash",
      "apply_patch",
      "write_file",
      "tilth_read",
      "tilth_search",
      "tilth_list",
    ],
    deferredNames: ["tilth_deps", "tilth_grok", "tilth_diff"],
    descriptionPattern: /dependencies.*symbol maps.*review/i,
    reviewHintPattern: /tilth_diff for structural change review/,
  },
] as const satisfies ReadonlyArray<{
  backend: CodeNavigationBackend;
  inlineNames: readonly string[];
  deferredNames: readonly string[];
  descriptionPattern: RegExp;
  reviewHintPattern: RegExp;
}>;

const settingsSchema = Type.Object({
  codemode: Type.Object({
    mode: Type.Literal("only"),
    inlineBudget: Type.Number(),
  }),
});

type GuidanceEvent = Pick<BeforeAgentStartEvent, "systemPrompt"> & {
  systemPromptOptions: Pick<BeforeAgentStartEvent["systemPromptOptions"], "selectedTools">;
};

interface LoadoutFixture {
  definitions: Map<string, ToolDefinition>;
  loadout: ToolLoadout;
  handlers: Map<string, (event: ToolResultEvent | GuidanceEvent) => unknown>;
  prepare: (selected?: ToolLoadout) => ToolLoadoutChanges | undefined;
}

function createLoadoutFixture(codeNavigation: CodeNavigationBackend = "srcwalk"): LoadoutFixture {
  const definitions = new Map<string, ToolDefinition>();
  const handlers = new Map<string, (event: ToolResultEvent | GuidanceEvent) => unknown>();
  const settings = parseJsonWithSchema(
    readFileSync(new URL("../settings.json", import.meta.url), "utf8"),
    settingsSchema,
    "ai/pi/settings.json",
  );
  const pi = {
    registerTool(tool: ToolDefinition): void {
      definitions.set(tool.name, tool);
    },
    on(name: string, handler: (event: ToolResultEvent | GuidanceEvent) => unknown): void {
      handlers.set(name, handler);
    },
    getSettings: () => settings,
    getActiveTools: () => loadout.declared.map((tool) => tool.name),
    getAllTools: () =>
      [...definitions.values()].map((tool) => ({
        ...tool,
        exposure: tool.exposure ?? "direct",
      })),
  } as unknown as ExtensionAPI;
  for (const extension of [
    applyPatchExtension,
    askUserQuestionExtension,
    readToolExtension,
    shellToolExtension,
    codeNavigation === "srcwalk" ? srcwalkCliExtension : tilthCliExtension,
    writeFileExtension,
    createCodemodeExtension(),
  ]) {
    extension(pi);
  }
  const registered: AgentTool[] = [...definitions.values()].map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute() {
      throw new Error("This fixture only inspects tool declarations.");
    },
  }));
  const getExposure: ToolLoadout["getExposure"] = (name) =>
    definitions.get(name)?.exposure ?? "direct";
  const declared = registered.filter((tool) =>
    ["direct", "model-only"].includes(getExposure(tool.name)),
  );
  const loadout: ToolLoadout = {
    registered,
    declared,
    callable: registered.filter((tool) => getExposure(tool.name) !== "model-only"),
    getExposure,
    getNamespace: (name) => definitions.get(name)?.namespace,
  };
  const prepareLoadout = definitions.get("codemode")?.prepareLoadout;
  assert.ok(prepareLoadout);
  return {
    definitions,
    loadout,
    handlers,
    prepare: (selected: ToolLoadout = loadout): ToolLoadoutChanges | undefined =>
      prepareLoadout(selected),
  };
}

for (const loadoutCase of loadoutCases) {
  test(`${loadoutCase.backend} describes its everyday core and defers specialized source analysis`, () => {
    const { definitions, loadout, prepare } = createLoadoutFixture(loadoutCase.backend);
    for (const name of loadoutCase.deferredNames) {
      assert.equal(definitions.get(name)?.exposure, "deferred", `${name} must be deferred`);
      assert.equal(definitions.get(name)?.namespace?.name, loadoutCase.backend);
      assert.ok(!loadout.declared.some((tool) => tool.name === name));
    }
    const changes = prepare();
    const description = changes?.descriptions?.["codemode"];
    assert.ok(description);
    for (const name of loadoutCase.inlineNames) {
      assert.ok(description.includes(`### \`${name}\``), `${name} must be described upfront`);
      assert.ok(changes.hiddenDeclarations?.includes(name));
    }
    for (const name of loadoutCase.deferredNames) {
      assert.ok(!description.includes(`### \`${name}\``), `${name} must not be described upfront`);
    }
    assert.match(description, new RegExp(`## ${loadoutCase.backend}`, "i"));
    assert.match(description, loadoutCase.descriptionPattern);
    assert.equal(definitions.get("ask_user_question")?.exposure, "model-only");
    assert.ok(!changes.hiddenDeclarations?.includes("ask_user_question"));
  });

  test(`${loadoutCase.backend} activation does not expand the codemode description`, () => {
    const { loadout, prepare } = createLoadoutFixture(loadoutCase.backend);
    const before = prepare()?.descriptions?.["codemode"];
    const tool = loadout.registered.find(
      (candidate) => candidate.name === loadoutCase.deferredNames[0],
    );
    assert.ok(tool);
    const expanded: ToolLoadout = { ...loadout, declared: [...loadout.declared, tool] };
    assert.equal(prepare(expanded)?.descriptions?.["codemode"], before);
  });

  test(`${loadoutCase.backend} shell hints recommend deferred structural review`, () => {
    const { handlers } = createLoadoutFixture(loadoutCase.backend);
    const handler = handlers.get("tool_result");
    assert.ok(handler);
    const result = handler({
      type: "tool_result",
      toolName: "bash",
      toolCallId: "bash-1",
      input: { command: "git diff" },
      content: [{ type: "text", text: "diff output" }],
      details: undefined,
      isError: false,
    });
    assert.ok(typeof result === "object" && result !== null && "content" in result);
    assert.match(JSON.stringify(result.content), loadoutCase.reviewHintPattern);
  });
}

function workflowPrompt(fixture: LoadoutFixture, selectedTools: string[]): string | undefined {
  const handler = fixture.handlers.get("before_agent_start");
  assert.ok(handler);
  const result = handler({ systemPrompt: "base prompt", systemPromptOptions: { selectedTools } });
  if (result === undefined) return undefined;
  assert.ok(typeof result === "object" && result !== null && "systemPrompt" in result);
  assert.ok(typeof result.systemPrompt === "string");
  return result.systemPrompt;
}

for (const backend of ["srcwalk", "tilth"] as const) {
  const detailedRule =
    backend === "srcwalk" ? "Use `srcwalk_context` only" : "Use `tilth_grok` only";

  test(`${backend} keeps detailed workflow in its namespace and injects only a bootstrap with codemode`, () => {
    const fixture = createLoadoutFixture(backend);
    const namespace = fixture.definitions.get(`${backend}_read`)?.namespace;
    assert.ok(namespace);
    assert.equal(namespace.name, backend);
    const instructions = namespace.instructions;
    assert.ok(instructions);
    assert.ok(instructions.includes(detailedRule));
    const prompt = workflowPrompt(fixture, ["codemode", `${backend}_read`]);
    assert.ok(prompt);
    assert.ok(prompt.startsWith("base prompt\n\n"));
    assert.ok(prompt.includes(`describeNamespace("${backend}")`));
    assert.match(prompt, /absent from current context/);
    assert.match(prompt, /read the returned instructions before/);
    assert.match(prompt, /Preserve evidence qualifiers/);
    assert.match(prompt, /structural results are not proof of runtime behavior/);
    assert.ok(!prompt.includes(detailedRule));
    assert.ok(!prompt.includes(instructions));
    assert.equal(workflowPrompt(fixture, ["codemode", `${backend}_read`]), prompt);
  });

  test(`${backend} retains full workflow for direct-tool sessions without codemode`, () => {
    const fixture = createLoadoutFixture(backend);
    const instructions = fixture.definitions.get(`${backend}_read`)?.namespace?.instructions;
    assert.ok(instructions?.includes(detailedRule));
    assert.equal(workflowPrompt(fixture, [`${backend}_read`]), `base prompt\n\n${instructions}`);
  });

  test(`${backend} does not inject workflow when its tools are not selected`, () => {
    assert.equal(
      workflowPrompt(createLoadoutFixture(backend), ["codemode", "read", "bash"]),
      undefined,
    );
  });
}
