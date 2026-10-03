import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  StdinBuffer,
  TUI_KEYBINDINGS,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { QuestionnaireDialog } from "./dialog.ts";
import { normalizeQuestions, type Result } from "./questionnaire.ts";

const theme = { fg: (_color: string, text: string) => text } as Theme;

interface Fixture {
  dialog: QuestionnaireDialog;
  results: Result[];
  keys: KeybindingsManager;
  terminal: { rows: number };
}

function fixture(count = 2): Fixture {
  const results: Result[] = [];
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const questions = normalizeQuestions({
    questions: Array.from({ length: count }, (_, index) => ({
      id: `q${index}`,
      prompt: "Which approach? 界🙂 " + "long description ".repeat(3),
      options: [
        { value: "a", label: "First", description: "Trade-offs ".repeat(5) },
        { value: "b", label: "Second" },
      ],
    })),
  });
  const terminal = { rows: 24 };
  const dialog = new QuestionnaireDialog(
    questions,
    {
      terminal,
      requestRender() {},
    } as TUI,
    theme,
    keys,
    (result) => results.push(result),
  );
  return { dialog, results, keys, terminal };
}

function enterCustom(dialog: QuestionnaireDialog): void {
  dialog.handleInput("\x1b[B");
  dialog.handleInput("\x1b[B");
  dialog.handleInput("\r");
}

test("Escape leaves editing with a saved draft, then cancels without partial answers", () => {
  const { dialog, results } = fixture();
  dialog.handleInput("\r"); // answer first question
  enterCustom(dialog);
  dialog.editor.setText("not a submitted decision");
  dialog.handleInput("\x1b");
  assert.equal(dialog.state.drafts.get("q1"), "not a submitted decision");
  assert.equal(results.length, 0);
  dialog.handleInput("\x1b");
  assert.deepEqual(results, [{ status: "cancelled", answers: [] }]);
});

test("Tab preserves separate drafts and restores them on reentering custom text", () => {
  const { dialog } = fixture();
  enterCustom(dialog);
  dialog.editor.setText("first draft");
  dialog.handleInput("\t");
  enterCustom(dialog);
  dialog.editor.setText("second draft");
  dialog.handleInput("\x1b[Z");
  enterCustom(dialog);
  assert.equal(dialog.editor.getExpandedText(), "first draft");
  assert.equal(dialog.state.drafts.get("q1"), "second draft");
});

test("deletion followed by submission in one stdin batch rejects the empty answer", () => {
  const { dialog, results } = fixture(1);
  enterCustom(dialog);
  dialog.handleInput("deleted answer");
  const stdin = new StdinBuffer();
  stdin.on("data", (data) => dialog.handleInput(data));
  try {
    stdin.process("\x15\r");
    assert.equal(dialog.editor.getExpandedText(), "");
    assert.equal(dialog.state.editing, true);
    assert.equal(dialog.state.answers.size, 0);
    assert.equal(results.length, 0);
    dialog.handleInput("replacement answer");
    dialog.handleInput("\r");
    assert.equal(results[0]?.answers[0]?.kind, "custom");
    assert.equal(results[0].answers[0].text, "replacement answer");
  } finally {
    stdin.destroy();
  }
});

test("undo after switching questions cannot restore another question's draft", () => {
  const { dialog } = fixture();
  dialog.focused = true;
  enterCustom(dialog);
  dialog.handleInput("first draft");
  const firstEditor = dialog.editor;
  dialog.handleInput("\t");
  enterCustom(dialog);
  assert.notEqual(dialog.editor, firstEditor);
  assert.equal(firstEditor.focused, false);
  assert.equal(dialog.editor.focused, true);
  dialog.handleInput("\x1b[45;5u"); // Ctrl+- (Kitty protocol)
  assert.equal(dialog.editor.getExpandedText(), "");
  dialog.handleInput("second draft");
  dialog.handleInput("\x1b[45;5u");
  assert.equal(dialog.editor.getExpandedText(), "");
  dialog.handleInput("\r");
  assert.equal(dialog.state.editing, true);
  assert.equal(dialog.state.answers.has("q1"), false);
  dialog.handleInput("\x1b[Z");
  enterCustom(dialog);
  assert.equal(dialog.editor.getExpandedText(), "first draft");
});

test("draft survives choosing an authored answer and returning to custom editing", () => {
  const { dialog } = fixture();
  enterCustom(dialog);
  dialog.editor.setText("retained");
  dialog.handleInput("\x1b");
  dialog.handleInput("\x1b[A");
  dialog.handleInput("\r");
  dialog.handleInput("\x1b[Z");
  enterCustom(dialog);
  assert.equal(dialog.editor.getExpandedText(), "retained");
});

test("paste content is expanded both when saving drafts and submitting text", () => {
  const { dialog, results } = fixture(1);
  enterCustom(dialog);
  const pasted = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
  dialog.handleInput("\x1b[200~" + pasted + "\x1b[201~");
  assert.equal(dialog.editor.getExpandedText(), pasted);
  assert.notEqual(dialog.editor.getText(), pasted); // exercises collapsed paste markers
  dialog.handleInput("\x1b");
  enterCustom(dialog);
  assert.equal(dialog.editor.getExpandedText(), pasted);
  dialog.handleInput("\r");
  assert.equal(results[0]?.status, "submitted");
  const answer = results[0].answers[0];
  assert.equal(answer?.kind, "custom");
  assert.equal(answer.text, pasted);
});

test("focus follows editing and is released on disposal", () => {
  const { dialog } = fixture();
  dialog.focused = true;
  assert.equal(dialog.editor.focused, false);
  enterCustom(dialog);
  assert.equal(dialog.editor.focused, true);
  dialog.focused = false;
  assert.equal(dialog.editor.focused, false);
  dialog.focused = true;
  dialog.handleInput("\t");
  assert.equal(dialog.editor.focused, false);
  enterCustom(dialog);
  dialog.dispose();
  assert.equal(dialog.editor.focused, false);
});

test("rendering fits narrow and changing widths including Unicode and multiline input", () => {
  const { dialog } = fixture();
  for (const editing of [false, true]) {
    if (editing) {
      enterCustom(dialog);
      dialog.editor.setText("界🙂\n" + "long text ".repeat(20));
      dialog.focused = true;
    }
    for (const width of [1, 2, 10, 40, 100, 20]) {
      dialog.invalidate();
      const lines = dialog.render(width);
      for (const line of lines)
        assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    }
  }
});

test("scrolling keeps the active choice visible in a short terminal", () => {
  const results: Result[] = [];
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const questions = normalizeQuestions({
    questions: [
      {
        id: "q1",
        prompt: "Choose one of these approaches.",
        options: Array.from({ length: 6 }, (_, index) => ({
          value: `${index + 1}`,
          label: `Choice ${index + 1}`,
          description: "A modest description that wraps across multiple terminal lines. ".repeat(2),
        })),
      },
    ],
  });
  const dialog = new QuestionnaireDialog(
    questions,
    { terminal: { rows: 24 }, requestRender() {} } as TUI,
    theme,
    keys,
    (result) => results.push(result),
  );

  for (let index = 0; index <= 6; index += 1) {
    const lines = dialog.render(80);
    assert.ok(lines.length <= 24);
    const active = lines.find((line) => line.startsWith("> "));
    const label = index === 6 ? "Type something..." : `Choice ${index + 1}`;
    assert.equal(active, `> ${index + 1}. ${label}`);
    if (index < 6) dialog.handleInput("\x1b[B");
  }
  for (let index = 6; index > 0; index -= 1) {
    dialog.handleInput("\x1b[A");
    const active = dialog.render(80).find((line) => line.startsWith("> "));
    assert.equal(active, `> ${index}. Choice ${index}`);
  }
  assert.equal(results.length, 0);
});

test("configured choice navigation keys move the selection and appear in hints", () => {
  const { dialog, keys } = fixture(1);
  keys.setUserBindings({
    "tui.select.up": ["up", "alt+k"],
    "tui.select.down": ["down", "alt+j"],
  });
  assert.equal(keys.matches("\x1bj", "tui.select.down"), true);
  dialog.handleInput("\x1bj");
  assert.equal(dialog.state.optionIndex, 1);
  dialog.handleInput("\x1bk");
  assert.equal(dialog.state.optionIndex, 0);
  const hints = dialog.render(100).join("\n");
  assert.ok(hints.includes("alt+k"));
  assert.ok(hints.includes("alt+j"));
});

test("long review answers are fully reachable with configured keys before submission", () => {
  const { dialog, keys, results } = fixture();
  enterCustom(dialog);
  const answerLines = Array.from({ length: 30 }, (_, index) => `answer line ${index}`);
  dialog.editor.setText(answerLines.join("\n"));
  dialog.handleInput("\r");
  dialog.handleInput("\r");
  assert.equal(dialog.state.question, undefined);
  keys.setUserBindings({
    "tui.select.up": "alt+k",
    "tui.select.down": "alt+j",
    "tui.select.confirm": "ctrl+y",
  });

  const initial = dialog.render(80);
  const seen = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const lines = dialog.render(80);
    assert.ok(lines.length <= 24);
    assert.ok(lines.some((line) => line.includes("ctrl+y submit")));
    assert.ok(lines.some((line) => line.includes("alt+k/alt+j scroll")));
    for (const line of lines) seen.add(line);
    dialog.handleInput("\x1bj");
  }
  for (const [index, line] of answerLines.entries()) {
    assert.ok(seen.has(index === 0 ? `Q1: ${line}` : line), `unreachable: ${line}`);
  }
  assert.ok(seen.has("Q2: First"));
  assert.equal(results.length, 0);
  const bottom = dialog.render(80);
  dialog.handleInput("\x1bj");
  assert.deepEqual(dialog.render(80), bottom);
  for (let index = 0; index < 50; index += 1) dialog.handleInput("\x1bk");
  assert.deepEqual(dialog.render(80), initial);
  dialog.handleInput("\r");
  assert.equal(results.length, 0);
  dialog.handleInput("\x19");
  assert.equal(results[0]?.status, "submitted");
  assert.equal(results[0].answers[0]?.kind, "custom");
  assert.equal(results[0].answers[0].text, answerLines.join("\n"));
  assert.equal(results[0].answers[1]?.kind, "choice");
});

test("review scrolling clamps on resize and resets after revisiting questions", () => {
  const { dialog, terminal, results } = fixture();
  enterCustom(dialog);
  dialog.editor.setText("界🙂 first line\n" + "another line\n".repeat(30) + "last line");
  dialog.handleInput("\r");
  dialog.handleInput("\r");
  const initial = dialog.render(80);
  for (let index = 0; index < 100; index += 1) {
    dialog.handleInput("\x1b[B");
    dialog.render(80);
  }
  assert.ok(dialog.render(80).includes("Q2: First"));
  terminal.rows = 60;
  assert.ok(dialog.render(80).includes("Q1: 界🙂 first line"));
  for (const width of [1, 2, 10, 40, 100, 20]) {
    terminal.rows = 4;
    dialog.invalidate();
    for (let index = 0; index < 20; index += 1) {
      const lines = dialog.render(width);
      assert.ok(lines.length <= terminal.rows);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      dialog.handleInput("\x1b[B");
    }
  }
  terminal.rows = 24;
  dialog.handleInput("\t"); // Q1
  dialog.handleInput("\t"); // Q2
  dialog.handleInput("\t"); // Review
  assert.deepEqual(dialog.render(80), initial);
  assert.equal(results.length, 0);
});

test("review controls remain reachable when the terminal cannot fit a pinned footer", () => {
  const { dialog, terminal, results } = fixture();
  dialog.handleInput("\r");
  dialog.handleInput("\r");
  terminal.rows = 1;
  const seen = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    const lines = dialog.render(80);
    assert.equal(lines.length, 1);
    for (const line of lines) seen.add(line);
    dialog.handleInput("\x1b[B");
  }
  assert.ok(seen.has("Q1: First"));
  assert.ok(seen.has("Q2: First"));
  assert.ok([...seen].some((line) => line.includes("enter submit")));
  assert.ok([...seen].some((line) => line.includes("switch questions")));
  assert.equal(results.length, 0);
});

test("configured selection, submission and newline keys work with Pi's editor", () => {
  const previous = getKeybindings();
  const { dialog, keys, results } = fixture(1);
  keys.setUserBindings({
    "tui.select.confirm": "ctrl+y",
    "tui.input.submit": "ctrl+s",
    "tui.input.newLine": "alt+enter",
  });
  setKeybindings(keys);
  try {
    dialog.handleInput("\x1b[B");
    dialog.handleInput("\x1b[B");
    dialog.handleInput("\x19");
    assert.equal(dialog.state.editing, true);
    dialog.handleInput("first");
    dialog.handleInput("\x1b\r");
    dialog.handleInput("second");
    dialog.handleInput("\x13");
    const answer = results[0]?.answers[0];
    assert.equal(answer?.kind, "custom");
    assert.equal(answer.text, "first\nsecond");
  } finally {
    setKeybindings(previous);
  }
});

test("backslash+Enter submission keeps expanded whitespace but removes Pi's escape", () => {
  const previous = getKeybindings();
  const { dialog, keys, results } = fixture(1);
  keys.setUserBindings({
    "tui.input.submit": "shift+enter",
    "tui.input.newLine": "enter",
  });
  setKeybindings(keys);
  try {
    enterCustom(dialog);
    const pasted = Array.from({ length: 30 }, (_, index) =>
      index === 0 ? "  first line" : index === 29 ? "last line " : `line ${index}`,
    ).join("\n");
    dialog.handleInput("\x1b[200~" + pasted + "\x1b[201~");
    assert.equal(dialog.editor.getExpandedText(), pasted);
    assert.notEqual(dialog.editor.getText(), pasted);
    dialog.handleInput("\\");
    dialog.handleInput("\r");

    const answer = results[0]?.answers[0];
    assert.equal(answer?.kind, "custom");
    assert.equal(answer.text, pasted);
  } finally {
    setKeybindings(previous);
  }
});

test("review requires all answers and lets the user revisit earlier questions", () => {
  const { dialog, results } = fixture();
  dialog.handleInput("\x1b[Z");
  dialog.handleInput("\r");
  assert.equal(results.length, 0);
  dialog.handleInput("\t");
  dialog.handleInput("\r");
  dialog.handleInput("\r");
  assert.equal(results.length, 0);
  dialog.handleInput("\r");
  assert.equal(results[0]?.status, "submitted");
});
