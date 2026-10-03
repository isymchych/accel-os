import { type Static, Type } from "typebox";

export const Parameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1, description: "Unique question identifier." }),
      label: Type.Optional(
        Type.String({ minLength: 1, description: "Short tab label; defaults to Q1, Q2, etc." }),
      ),
      prompt: Type.String({ minLength: 1, description: "The complete question." }),
      options: Type.Array(
        Type.Object({
          value: Type.String({
            minLength: 1,
            description: "Stable choice identifier within this question.",
          }),
          label: Type.String({ minLength: 1, description: "Concise choice label." }),
          description: Type.Optional(
            Type.String({ description: "Meaning or trade-offs of this choice." }),
          ),
        }),
        { minItems: 2, maxItems: 6 },
      ),
    }),
    { minItems: 1, maxItems: 4 },
  ),
});

export type Params = Static<typeof Parameters>;
export type Question = Params["questions"][number] & { label: string };
export type Answer = { id: string; prompt: string } & (
  | { kind: "choice"; value: string; label: string }
  | { kind: "custom"; text: string }
);
export type Result =
  | { status: "submitted"; answers: Answer[] }
  | { status: "cancelled" | "aborted" | "unavailable"; answers: [] };

export function normalizeQuestions(params: Params): Question[] {
  if (params.questions.length < 1 || params.questions.length > 4) {
    throw new Error("Provide 1-4 questions.");
  }
  const ids = new Set<string>();
  return params.questions.map((question, index) => {
    requireText(question.id, "Question ID");
    requireText(question.prompt, "Question prompt");
    if (ids.has(question.id)) throw new Error("Question IDs must be unique.");
    ids.add(question.id);
    if (question.label !== undefined) requireText(question.label, "Tab label");
    if (question.options.length < 2 || question.options.length > 6) {
      throw new Error("Provide 2-6 choices per question.");
    }
    const values = new Set<string>();
    for (const option of question.options) {
      requireText(option.value, "Choice value");
      requireText(option.label, "Choice label");
      if (values.has(option.value))
        throw new Error("Choice values must be unique within each question.");
      values.add(option.value);
    }
    return { ...question, label: question.label ?? `Q${index + 1}` };
  });
}

function requireText(text: string, field: string): void {
  if (!text.trim()) throw new Error(`${field} must not be blank.`);
}

/** Invocation-local answers and drafts; drafts become decisions only on submission. */
export class Questionnaire {
  public currentTab = 0;
  public optionIndex = 0;
  public editing = false;
  public readonly answers = new Map<string, Answer>();
  public readonly drafts = new Map<string, string>();
  public readonly questions: readonly Question[];

  public constructor(questions: readonly Question[]) {
    this.questions = questions;
  }

  public get question(): Question | undefined {
    return this.questions[this.currentTab];
  }

  public get isGrouped(): boolean {
    return this.questions.length > 1;
  }

  public get complete(): boolean {
    return this.questions.every((question) => this.answers.has(question.id));
  }

  public moveTab(delta: number): void {
    if (!this.isGrouped) return;
    this.currentTab =
      (this.currentTab + delta + this.questions.length + 1) % (this.questions.length + 1);
    this.optionIndex = 0;
    this.editing = false;
  }

  public moveOption(delta: number): void {
    if (!this.question) return;
    this.optionIndex = Math.max(
      0,
      Math.min(this.question.options.length, this.optionIndex + delta),
    );
  }

  public choose(): Result | undefined {
    const question = this.question;
    if (!question) return this.submit();
    const option = question.options[this.optionIndex];
    if (!option) {
      this.editing = true;
      return undefined;
    }
    this.answers.set(question.id, {
      id: question.id,
      prompt: question.prompt,
      kind: "choice",
      value: option.value,
      label: option.label,
    });
    return this.advance();
  }

  public submitText(text: string): Result | undefined {
    const question = this.question;
    if (!question) return undefined;
    this.drafts.set(question.id, text);
    if (!text.trim()) return undefined;
    this.answers.set(question.id, {
      id: question.id,
      prompt: question.prompt,
      kind: "custom",
      text,
    });
    this.editing = false;
    return this.advance();
  }

  public submit(): Result | undefined {
    const answers: Answer[] = [];
    for (const question of this.questions) {
      const answer = this.answers.get(question.id);
      if (!answer) return undefined;
      answers.push(answer);
    }
    return { status: "submitted", answers };
  }

  private advance(): Result | undefined {
    if (!this.isGrouped) return this.submit();
    this.currentTab = Math.min(this.currentTab + 1, this.questions.length);
    this.optionIndex = 0;
    return undefined;
  }
}

export function answerText(answer: Answer): string {
  return answer.kind === "choice" ? answer.label : answer.text;
}

export function formatResult(result: Result): string {
  if (result.status !== "submitted") {
    const messages = {
      cancelled: "User cancelled the questionnaire. No answers were submitted.",
      aborted: "Questionnaire aborted. No answers were submitted.",
      unavailable:
        "Questionnaire UI unavailable. The user did not see the questions. Ask in plain chat instead.",
    };
    return messages[result.status];
  }
  return result.answers
    .map(
      (answer) =>
        `${answer.id}: ${answer.prompt}\n${
          answer.kind === "choice"
            ? `User selected: label=${JSON.stringify(answer.label)}, value=${JSON.stringify(answer.value)}`
            : `User wrote: ${answer.text}`
        }`,
    )
    .join("\n\n");
}
