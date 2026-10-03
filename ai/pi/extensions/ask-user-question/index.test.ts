import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionToolContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";

import type { QuestionnaireDialog } from "./dialog.ts";
import extension, { showQuestionnaire, TOOL_NAME } from "./index.ts";
import { normalizeQuestions, Parameters, type Result } from "./questionnaire.ts";

const params = {
  questions: [
    {
      id: "q",
      prompt: "Which?",
      options: [
        { value: "a", label: "First" },
        { value: "b", label: "Second" },
      ],
    },
  ],
};
const questions = normalizeQuestions(params);
const theme = { fg: (_color: string, text: string) => text } as Theme;
type Factory = (
  tui: TUI,
  theme: Theme,
  keys: KeybindingsManager,
  done: (result: Result) => void,
) => QuestionnaireDialog;

interface UiFixture {
  ctx: ExtensionToolContext;
  dialog: () => QuestionnaireDialog;
  calls: () => number;
  disposed: () => number;
}

function uiFixture(beforeFactory?: () => void): UiFixture {
  let dialog: QuestionnaireDialog | undefined;
  let calls = 0;
  let disposed = 0;
  const ctx = {
    mode: "tui",
    ui: {
      async custom(factory: Factory) {
        calls += 1;
        beforeFactory?.();
        return new Promise<Result>((resolve) => {
          const lifecycle = { finished: false };
          const done = (result: Result): void => {
            lifecycle.finished = true;
            resolve(result);
            dialog?.dispose();
            disposed += 1;
          };
          dialog = factory(
            { terminal: { rows: 24 }, requestRender() {} } as TUI,
            theme,
            new KeybindingsManager(TUI_KEYBINDINGS),
            done,
          );
          if (!lifecycle.finished) dialog.focused = true;
        });
      },
    },
  } as unknown as ExtensionToolContext;
  return {
    ctx,
    dialog: (): QuestionnaireDialog => {
      assert.ok(dialog);
      return dialog;
    },
    calls: (): number => calls,
    disposed: (): number => disposed,
  };
}

interface RegistrationFixture {
  tool: ToolDefinition<typeof Parameters, Result>;
  emit: (name: string, mode: string) => void;
  active: () => string[];
  deactivate: () => void;
}

function registrationFixture(): RegistrationFixture {
  let tool: ToolDefinition<typeof Parameters, Result> | undefined;
  let active = ["bash", TOOL_NAME];
  const handlers = new Map<string, (event: unknown, ctx: { mode: string }) => void>();
  const pi = {
    registerTool(value: ToolDefinition<typeof Parameters, Result>) {
      tool = value;
    },
    on(name: string, handler: (event: unknown, ctx: { mode: string }) => void) {
      handlers.set(name, handler);
    },
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
  } as unknown as ExtensionAPI;
  extension(pi);
  assert.ok(tool);
  return {
    tool,
    emit(name, mode): void {
      const handler = handlers.get(name);
      assert.ok(handler);
      handler({}, { mode });
    },
    active: (): string[] => active,
    deactivate: (): void => {
      active = ["bash"];
    },
  };
}

test("registration is active, sequential and model-only without provider strict sampling", () => {
  const { tool } = registrationFixture();
  assert.equal(tool.name, TOOL_NAME);
  assert.equal(tool.exposure, "model-only");
  assert.equal(tool.executionMode, "sequential");
  assert.notEqual(tool.defaultActive, false);
  assert.equal(tool.constrainedSampling, undefined);
});

test("non-TUI sessions hide the tool without restoring deliberate deactivation", () => {
  for (const mode of ["rpc", "print", "json"]) {
    const fixture = registrationFixture();
    fixture.emit("session_start", mode);
    assert.deepEqual(fixture.active(), ["bash"]);
    fixture.emit("before_agent_start", mode);
    assert.deepEqual(fixture.active(), ["bash"]);
  }
  const fixture = registrationFixture();
  fixture.deactivate();
  fixture.emit("before_agent_start", "tui");
  assert.deepEqual(fixture.active(), ["bash"]);
});

test("non-TUI execution reports an error instead of user cancellation", async () => {
  const { tool } = registrationFixture();
  const fixture = uiFixture();
  const result = await tool.execute("call", params, undefined, undefined, {
    ...fixture.ctx,
    mode: "rpc",
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { status: "unavailable", answers: [] });
  assert.equal(fixture.calls(), 0);
});

test("invalid semantic input fails before the dialog opens", async () => {
  const { tool } = registrationFixture();
  const fixture = uiFixture();
  await assert.rejects(
    tool.execute(
      "call",
      {
        questions: [
          { ...questions[0], id: " ", prompt: "Which?", options: questions[0]?.options ?? [] },
        ],
      },
      undefined,
      undefined,
      fixture.ctx,
    ),
    /blank/,
  );
  assert.equal(fixture.calls(), 0);
});

test("abort before opening does not create UI", async () => {
  const fixture = uiFixture();
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await showQuestionnaire(fixture.ctx, questions, controller.signal), {
    status: "aborted",
    answers: [],
  });
  assert.equal(fixture.calls(), 0);
});

test("abort between the initial guard and factory invocation closes the interaction", async () => {
  const controller = new AbortController();
  const fixture = uiFixture(() => controller.abort());
  assert.deepEqual(await showQuestionnaire(fixture.ctx, questions, controller.signal), {
    status: "aborted",
    answers: [],
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("abort while editing closes once, submits no drafts and removes the listener", async () => {
  const fixture = uiFixture();
  const controller = new AbortController();
  const pending = showQuestionnaire(fixture.ctx, questions, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  fixture.dialog().handleInput("\x1b[B");
  fixture.dialog().handleInput("\x1b[B");
  fixture.dialog().handleInput("\r");
  fixture.dialog().editor.setText("draft only");
  controller.abort();
  assert.deepEqual(await pending, { status: "aborted", answers: [] });
  assert.equal(fixture.disposed(), 1);
  assert.equal(fixture.dialog().editor.focused, false);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("successful submission and cancellation both remove the abort listener", async () => {
  for (const key of ["\r", "\x1b"]) {
    const fixture = uiFixture();
    const controller = new AbortController();
    const pending = showQuestionnaire(fixture.ctx, questions, controller.signal);
    fixture.dialog().handleInput(key);
    const result = await pending;
    assert.equal(result.status, key === "\r" ? "submitted" : "cancelled");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    assert.equal(fixture.disposed(), 1);
  }
});

test("session shutdown closes an active questionnaire and a new session is usable", async () => {
  const { tool, emit } = registrationFixture();
  const first = uiFixture();
  const pending = tool.execute("call", params, undefined, undefined, first.ctx);
  emit("session_shutdown", "tui");
  assert.equal((await pending).details.status, "aborted");
  emit("session_start", "tui");
  const next = uiFixture();
  const nextPending = tool.execute("call2", params, undefined, undefined, next.ctx);
  next.dialog().handleInput("\r");
  assert.equal((await nextPending).details.status, "submitted");
});

test("late completion cannot overwrite an already submitted result", async () => {
  const fixture = uiFixture();
  const pending = showQuestionnaire(fixture.ctx, questions);
  fixture.dialog().handleInput("\r");
  fixture.dialog().handleInput("\x1b");
  assert.equal((await pending).status, "submitted");
  assert.equal(fixture.disposed(), 1);
});
