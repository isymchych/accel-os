import assert from "node:assert/strict";
import test from "node:test";

import { formatResult, normalizeQuestions, Questionnaire, type Params } from "./questionnaire.ts";

function params(count = 1): Params {
  return {
    questions: Array.from({ length: count }, (_, index) => ({
      id: `q${index}`,
      prompt: `Question ${index}?`,
      options: [
        { value: "a", label: "First" },
        { value: "b", label: "Second" },
      ],
    })),
  };
}

function questionAt(input: Params, index = 0): Params["questions"][number] {
  const question = input.questions[index];
  assert.ok(question);
  return question;
}

function optionAt(input: Params, index = 0): Params["questions"][number]["options"][number] {
  const option = questionAt(input).options[index];
  assert.ok(option);
  return option;
}

test("normalization supplies tab labels without changing authored identifiers or text", () => {
  const input = params(2);
  questionAt(input, 1).label = "Scope";
  const questions = normalizeQuestions(input);
  assert.deepEqual(
    questions.map((question) => question.label),
    ["Q1", "Scope"],
  );
  assert.equal(questionAt(input).label, undefined);
});

test("validation rejects invalid counts, blank strings and duplicate identifiers", () => {
  for (const count of [0, 5]) assert.throws(() => normalizeQuestions(params(count)), /1-4/);
  for (const options of [
    [],
    Array.from({ length: 7 }, (_, index) => ({ value: String(index), label: "Choice" })),
  ]) {
    const input = params();
    questionAt(input).options = options;
    assert.throws(() => normalizeQuestions(input), /2-6/);
  }
  for (const field of ["id", "prompt", "label"] as const) {
    const input = params();
    questionAt(input)[field] = " \n ";
    assert.throws(() => normalizeQuestions(input), /blank/);
  }
  for (const field of ["value", "label"] as const) {
    const input = params();
    optionAt(input)[field] = " ";
    assert.throws(() => normalizeQuestions(input), /blank/);
  }
  const duplicateQuestions = params(2);
  questionAt(duplicateQuestions, 1).id = "q0";
  assert.throws(() => normalizeQuestions(duplicateQuestions), /IDs must be unique/);
  const duplicateOptions = params();
  optionAt(duplicateOptions, 1).value = "a";
  assert.throws(() => normalizeQuestions(duplicateOptions), /values must be unique/);
  // Reusing option values across questions is valid.
  assert.equal(normalizeQuestions(params(2)).length, 2);
});

test("a single choice submits immediately with identity separate from display", () => {
  const state = new Questionnaire(normalizeQuestions(params()));
  state.moveOption(1);
  assert.deepEqual(state.choose(), {
    status: "submitted",
    answers: [{ id: "q0", prompt: "Question 0?", kind: "choice", value: "b", label: "Second" }],
  });
});

test("blank custom text does not submit; nonblank multiline text is preserved exactly", () => {
  const state = new Questionnaire(normalizeQuestions(params()));
  state.moveOption(2);
  assert.equal(state.choose(), undefined);
  assert.equal(state.editing, true);
  assert.equal(state.submitText(" \n "), undefined);
  assert.equal(state.editing, true);
  assert.equal(state.answers.size, 0);
  const result = state.submitText("  answer\nwith detail\n");
  assert.deepEqual(result?.answers, [
    { id: "q0", prompt: "Question 0?", kind: "custom", text: "  answer\nwith detail\n" },
  ]);
});

test("grouped submission requires completeness and orders answers by question", () => {
  const state = new Questionnaire(normalizeQuestions(params(2)));
  state.moveTab(-1);
  assert.equal(state.question, undefined);
  assert.equal(state.submit(), undefined);
  state.moveTab(-1);
  assert.equal(state.choose(), undefined);
  assert.equal(state.currentTab, 2);
  assert.equal(state.submit(), undefined);
  state.moveTab(1);
  state.choose();
  assert.equal(state.currentTab, 1);
  state.moveTab(1);
  assert.deepEqual(
    state.submit()?.answers.map((answer) => answer.id),
    ["q0", "q1"],
  );
});

test("replacing answers does not clear drafts or mutate an already submitted result", () => {
  const state = new Questionnaire(normalizeQuestions(params()));
  state.moveOption(2);
  state.choose();
  const first = state.submitText("custom draft");
  state.optionIndex = 0;
  const second = state.choose();
  assert.equal(state.drafts.get("q0"), "custom draft");
  assert.equal(first?.answers[0]?.kind, "custom");
  assert.equal(second?.answers[0]?.kind, "choice");
});

test("non-submission outcomes are distinct and carry no answer text", () => {
  const texts = (["cancelled", "aborted", "unavailable"] as const).map((status) =>
    formatResult({ status, answers: [] }),
  );
  assert.equal(new Set(texts).size, 3);
  assert.match(texts[0] ?? "", /No answers were submitted/);
  assert.match(texts[2] ?? "", /did not see/);
});

test("formatted choices retain stable values when display labels match", () => {
  const input = params();
  questionAt(input).options = [
    { value: "staging", label: "Deploy", description: "Deploy to staging." },
    { value: "production", label: "Deploy", description: "Deploy to production." },
  ];
  const texts = questionAt(input).options.map((option, index) => {
    const state = new Questionnaire(normalizeQuestions(input));
    state.moveOption(index);
    const result = state.choose();
    assert.ok(result);
    const text = formatResult(result);
    assert.ok(
      text.includes(`User selected: label="Deploy", value=${JSON.stringify(option.value)}`),
    );
    return text;
  });
  assert.notEqual(texts[0], texts[1]);
});

test("formatted choice labels and values are quoted without changing custom text", () => {
  const input = params();
  const option = optionAt(input);
  option.label = 'Deploy "now"\nplease';
  option.value = 'production"\nnext';
  const state = new Questionnaire(normalizeQuestions(input));
  const choice = state.choose();
  assert.ok(choice);
  assert.equal(
    formatResult(choice),
    `q0: Question 0?\nUser selected: label=${JSON.stringify(option.label)}, value=${JSON.stringify(option.value)}`,
  );
  const custom = state.submitText('  custom "answer"\nwith detail\n');
  assert.ok(custom);
  assert.equal(
    formatResult(custom),
    'q0: Question 0?\nUser wrote:   custom "answer"\nwith detail\n',
  );
});
