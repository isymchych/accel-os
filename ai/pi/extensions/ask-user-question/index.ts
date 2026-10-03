/**
 * Structured clarification questions for interactive Pi sessions.
 *
 * Offers authored choices and free text, preserving drafts until explicit
 * submission. Cancellation never submits partial decisions. The tool is
 * model-only so user interaction cannot be hidden inside a codemode script.
 */
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { QuestionnaireDialog } from "./dialog.ts";
import {
  formatResult,
  normalizeQuestions,
  Parameters,
  type Params,
  type Question,
  type Result,
} from "./questionnaire.ts";

export const TOOL_NAME = "ask_user_question";

export async function showQuestionnaire(
  ctx: Pick<ExtensionToolContext, "ui">,
  questions: readonly Question[],
  signal?: AbortSignal,
): Promise<Result> {
  if (signal?.aborted) return { status: "aborted", answers: [] };
  let removeAbortListener = (): void => {};
  try {
    return await ctx.ui.custom<Result>((tui, theme, keybindings, done) => {
      let finished = false;
      const finish = (result: Result): void => {
        if (finished) return;
        finished = true;
        removeAbortListener();
        done(result);
      };
      const dialog = new QuestionnaireDialog(questions, tui, theme, keybindings, finish, () =>
        removeAbortListener(),
      );
      const abort = (): void => finish({ status: "aborted", answers: [] });
      removeAbortListener = (): void => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      // The signal can change between the initial guard and factory invocation.
      if (signal?.aborted) abort();
      return dialog;
    });
  } finally {
    removeAbortListener();
  }
}

export default function askUserQuestionExtension(pi: ExtensionAPI): void {
  let sessionAbort = new AbortController();
  const hideWithoutTui = (_event: unknown, ctx: { mode: string }): void => {
    if (ctx.mode !== "tui" && pi.getActiveTools().includes(TOOL_NAME)) {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== TOOL_NAME));
    }
  };
  pi.on("session_start", (event, ctx) => {
    sessionAbort = new AbortController();
    hideWithoutTui(event, ctx);
  });
  pi.on("before_agent_start", hideWithoutTui);
  pi.on("session_shutdown", () => sessionAbort.abort());

  const tool: ToolDefinition<typeof Parameters, Result | undefined> = {
    name: TOOL_NAME,
    label: "Ask User Question",
    description:
      "Ask the user structured questions with choices and a free-text alternative when a consequential missing decision blocks progress. Group related questions into one call.",
    promptSnippet: "Ask for consequential missing decisions using choices or free text.",
    promptGuidelines: [
      "Use ask_user_question only when a user decision blocks progress, not for details you can reasonably resolve. Group related questions.",
      "Provide 1-4 questions with 2-6 distinct choices each. Free text is offered automatically; do not add an Other choice.",
      "Questionnaire answers express preferences or decisions; they do not implicitly authorize unrelated work. Cancellation submits no answers.",
    ],
    parameters: Parameters,
    exposure: "model-only",
    executionMode: "sequential",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        const details: Result = { status: "unavailable", answers: [] };
        return { content: [{ type: "text", text: formatResult(details) }], details, isError: true };
      }
      const questions = normalizeQuestions(params);
      const signals = [sessionAbort.signal, signal ?? ctx.signal].filter(
        (value): value is AbortSignal => value !== undefined,
      );
      const details = await showQuestionnaire(ctx, questions, AbortSignal.any(signals));
      return { content: [{ type: "text", text: formatResult(details) }], details };
    },
    renderCall(args, theme) {
      const partial: Partial<Params> = args;
      const questions = partial.questions ?? [];
      return new Text(
        theme.fg("toolTitle", theme.bold("ask_user_question ")) +
          theme.fg("muted", `${questions.length} question(s)`) +
          (questions.length ? "\n" + questions.map((question) => question.prompt).join("\n") : ""),
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const details = result.details;
      if (!details) {
        return new Text(
          result.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n"),
          0,
          0,
        );
      }
      return new Text(
        theme.fg(details.status === "submitted" ? "success" : "warning", formatResult(details)),
        0,
        0,
      );
    },
  };
  pi.registerTool(tool);
}
