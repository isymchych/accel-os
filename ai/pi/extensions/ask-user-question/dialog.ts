import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  type KeybindingsManager,
  matchesKey,
  ScrollView,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { answerText, Questionnaire, type Question, type Result } from "./questionnaire.ts";

/** Pi owns terminal rendering; this component owns one questionnaire interaction. */
export class QuestionnaireDialog {
  public readonly state: Questionnaire;
  public editor: Editor;
  private hasFocus = false;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly done: (result: Result) => void;
  private readonly cleanup: () => void;
  private readonly reviewScroll: ScrollView;
  private optionScrollOffset = 0;
  private latestEditorText = "";
  private pendingSubmissionText: string | undefined;
  private editorQuestionId: string | undefined;

  public constructor(
    questions: readonly Question[],
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: Result) => void,
    cleanup: () => void = (): void => {},
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.cleanup = cleanup;
    this.state = new Questionnaire(questions);
    this.reviewScroll = new ScrollView({
      render: (width): string[] => this.renderReviewAnswers(width),
      invalidate(): void {},
    });
    this.editor = this.createEditor();
    this.editorQuestionId = this.state.question?.id;
  }

  private createEditor(): Editor {
    const theme = this.theme;
    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };
    const editor = new Editor(this.tui, editorTheme);
    editor.onChange = (): void => this.trackEditorText();
    editor.onSubmit = (): void => {
      // Pi clears the editor before onSubmit. trackEditorText retains the expanded
      // pre-clear value through this synchronous callback, after Pi has consumed a
      // backslash+Enter submission escape.
      const question = this.state.question;
      if (!question) return;
      const text = this.pendingSubmissionText ?? this.latestEditorText;
      this.pendingSubmissionText = undefined;
      const result = this.state.submitText(text);
      if (this.state.editing) this.editor.setText(text);
      this.finishOrRefresh(result);
    };
    return editor;
  }

  public get focused(): boolean {
    return this.hasFocus;
  }
  public set focused(value: boolean) {
    this.hasFocus = value;
    this.editor.focused = value && this.state.editing;
  }

  public invalidate(): void {
    this.editor.invalidate();
  }

  public dispose(): void {
    this.editor.focused = false;
    this.cleanup();
  }

  private saveDraft(): void {
    const question = this.state.question;
    if (question && this.state.editing) {
      this.state.drafts.set(question.id, this.editor.getExpandedText());
    }
  }

  private trackEditorText(): void {
    const text = this.editor.getExpandedText();
    // Preserve the pre-clear value only for onSubmit within this input dispatch.
    // Genuine deletion updates the current value immediately, even in a batch.
    this.pendingSubmissionText = text === "" ? this.latestEditorText : undefined;
    this.latestEditorText = text;
  }

  private finishOrRefresh(result?: Result): void {
    if (result) this.done(result);
    else {
      if (this.state.question) this.reviewScroll.scrollToStart();
      this.focused = this.hasFocus;
      this.tui.requestRender();
    }
  }

  private restoreDraft(): void {
    const question = this.state.question;
    if (this.state.editing && question) {
      if (this.editorQuestionId !== question.id) {
        // setText preserves undo snapshots, so a new owner needs a new editor.
        this.editor.focused = false;
        this.editor = this.createEditor();
        this.editorQuestionId = question.id;
        this.latestEditorText = "";
        this.pendingSubmissionText = undefined;
      }
      this.editor.setText(this.state.drafts.get(question.id) ?? "");
    }
  }

  public handleInput(data: string): void {
    // Tab changes questions even while editing; arrows remain editor navigation.
    if (this.state.isGrouped && (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab")))) {
      this.saveDraft();
      this.state.moveTab(matchesKey(data, Key.tab) ? 1 : -1);
      this.optionScrollOffset = 0;
      this.finishOrRefresh();
      return;
    }
    if (this.state.editing) {
      if (matchesKey(data, Key.escape)) {
        this.saveDraft();
        this.state.editing = false;
        this.finishOrRefresh();
      } else {
        this.saveDraft();
        this.latestEditorText = this.editor.getExpandedText();
        this.pendingSubmissionText = undefined;
        try {
          this.editor.handleInput(data);
        } finally {
          this.latestEditorText = this.editor.getExpandedText();
          this.pendingSubmissionText = undefined;
        }
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.done({ status: "cancelled", answers: [] });
      return;
    }
    if (this.state.isGrouped && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
      this.state.moveTab(matchesKey(data, Key.right) ? 1 : -1);
      this.optionScrollOffset = 0;
    } else if (this.keybindings.matches(data, "tui.select.up")) {
      if (this.state.question) this.state.moveOption(-1);
      else this.reviewScroll.scrollBy(-1);
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      if (this.state.question) this.state.moveOption(1);
      else this.reviewScroll.scrollBy(1);
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      const result = this.state.choose();
      this.optionScrollOffset = 0;
      this.restoreDraft();
      this.finishOrRefresh(result);
      return;
    }
    this.finishOrRefresh();
  }

  public render(width: number): string[] {
    const renderWidth = Math.max(1, width);
    const add = (lines: string[], text: string, prefix = ""): void =>
      this.addWrapped(lines, renderWidth, text, prefix);
    const header: string[] = [this.theme.fg("accent", "-".repeat(renderWidth))];
    if (this.state.isGrouped) {
      const tabs = this.state.questions.map((question, index) => {
        const marker = this.state.answers.has(question.id) ? "[x]" : "[ ]";
        const text = `${marker} ${question.label}`;
        return this.theme.fg(index === this.state.currentTab ? "accent" : "muted", text);
      });
      tabs.push(this.theme.fg(this.state.question ? "muted" : "accent", "Review"));
      add(header, tabs.join(" | "));
      header.push("");
    }

    const question = this.state.question;
    if (!question) return this.renderReview(header, renderWidth, add);

    const promptLines: string[] = [];
    add(promptLines, this.theme.fg("text", question.prompt));
    header.push(...promptLines, "");

    const { lines: optionLines, ranges } = this.renderOptions(question, renderWidth);
    const footer = this.renderFooter(renderWidth, add);
    const rows = Math.max(1, this.tui.terminal.rows);
    // At normal sizes retain the full prompt and tabs. If they would consume
    // the viewport, retain its first line so the active choice still renders.
    const visibleHeader =
      header.length + footer.length + 1 <= rows ? header : promptLines.slice(0, 1);
    const optionBudget = Math.max(1, rows - visibleHeader.length - footer.length);
    const visibleOptions = this.visibleOptions(optionLines, ranges, optionBudget);
    return [...visibleHeader, ...visibleOptions, ...footer]
      .slice(0, rows)
      .map((line) => truncateToWidth(line, renderWidth, ""));
  }

  private renderReview(
    header: string[],
    width: number,
    add: (lines: string[], text: string, prefix?: string) => void,
  ): string[] {
    const title: string[] = [];
    add(title, this.theme.fg("accent", "Review your answers"));
    header.push(...title);
    const content = this.reviewScroll.render(width);
    const footer: string[] = [];
    if (!this.state.complete) {
      add(footer, this.theme.fg("warning", "Answer every question before submitting."));
    }
    footer.push(...this.renderFooter(width, add));
    const rows = Math.max(1, this.tui.terminal.rows);
    let visibleHeader = header.length + footer.length + 1 <= rows ? header : title.slice(0, 1);
    let visibleFooter = footer;
    if (visibleHeader.length + footer.length + 1 > rows) {
      // Tiny layouts still need an answer row; let controls scroll with the body.
      content.push(...footer);
      visibleFooter = [];
      visibleHeader = rows > 1 ? title.slice(0, 1) : [];
    }
    const viewportHeight = Math.max(1, rows - visibleHeader.length - visibleFooter.length);
    this.reviewScroll.updateLayout(content.length, viewportHeight, () => this.tui.requestRender());
    // This dialog renders flat lines rather than exposing ScrollView's layout node.
    const viewport = content.slice(
      this.reviewScroll.scrollTop,
      this.reviewScroll.scrollTop + viewportHeight,
    );
    return [...visibleHeader, ...viewport, ...visibleFooter].map((line) =>
      truncateToWidth(line, width, ""),
    );
  }

  private renderReviewAnswers(width: number): string[] {
    const lines: string[] = [];
    for (const item of this.state.questions) {
      const answer = this.state.answers.get(item.id);
      this.addWrapped(
        lines,
        width,
        `${item.label}: ${answer ? answerText(answer) : "(unanswered)"}`,
      );
    }
    return lines;
  }

  private renderOptions(
    question: Question,
    width: number,
  ): { lines: string[]; ranges: { start: number; end: number }[] } {
    const lines: string[] = [];
    const ranges: { start: number; end: number }[] = [];
    const options = [
      ...question.options,
      { value: "", label: "Type something...", description: undefined },
    ];
    for (const [index, option] of options.entries()) {
      const start = lines.length;
      const active = index === this.state.optionIndex;
      this.addWrapped(
        lines,
        width,
        this.theme.fg(active ? "accent" : "text", `${index + 1}. ${option.label}`),
        active ? "> " : "  ",
      );
      if (option.description)
        this.addWrapped(lines, width, this.theme.fg("muted", option.description), "    ");
      ranges.push({ start, end: lines.length });
    }
    return { lines, ranges };
  }

  private renderFooter(
    width: number,
    add: (lines: string[], text: string, prefix?: string) => void,
  ): string[] {
    const lines: string[] = [];
    if (this.state.editing) {
      lines.push("");
      add(lines, this.theme.fg("muted", "Your answer:"));
      // Editor reserves a cursor column; a one-column layout cannot wrap
      // double-width graphemes. Render at least three columns, then clip.
      lines.push(...this.editor.render(Math.max(3, width)));
    }
    lines.push("");
    const confirm = this.keybindings.getKeys("tui.select.confirm").join("/");
    const submit = this.keybindings.getKeys("tui.input.submit").join("/");
    const newline = this.keybindings.getKeys("tui.input.newLine").join("/");
    const up = this.keybindings.getKeys("tui.select.up").join("/");
    const down = this.keybindings.getKeys("tui.select.down").join("/");
    add(
      lines,
      this.theme.fg(
        "dim",
        this.state.editing
          ? `${submit} submit text | ${newline} newline | Esc back`
          : this.state.question
            ? `${up}/${down} choose | ${confirm} confirm | Esc cancel`
            : `${up}/${down} scroll | ${confirm} submit | Esc cancel`,
      ),
    );
    if (this.state.isGrouped) add(lines, this.theme.fg("dim", "Tab/Shift+Tab switch questions"));
    lines.push(this.theme.fg("accent", "-".repeat(width)));
    return lines;
  }

  private visibleOptions(
    lines: string[],
    ranges: { start: number; end: number }[],
    budget: number,
  ): string[] {
    if (lines.length <= budget) {
      this.optionScrollOffset = 0;
      return lines;
    }
    const showIndicators = budget >= 3;
    const viewport = budget - (showIndicators ? 2 : 0);
    const active = ranges[this.state.optionIndex] ?? { start: 0, end: 1 };
    const maxOffset = Math.max(0, lines.length - viewport);
    let offset = Math.min(this.optionScrollOffset, maxOffset);
    if (active.start < offset) offset = active.start;
    else if (active.end > offset + viewport) {
      offset = active.end - active.start <= viewport ? active.end - viewport : active.start;
    }
    this.optionScrollOffset = Math.max(0, Math.min(maxOffset, offset));

    const visible = lines.slice(this.optionScrollOffset, this.optionScrollOffset + viewport);
    if (!showIndicators) return visible;
    return [
      ...(this.optionScrollOffset > 0 ? [this.theme.fg("dim", "↑ more choices")] : []),
      ...visible,
      ...(this.optionScrollOffset + viewport < lines.length
        ? [this.theme.fg("dim", "↓ more choices")]
        : []),
    ];
  }

  private addWrapped(lines: string[], width: number, text: string, prefix = ""): void {
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth >= width) {
      lines.push(...wrapTextWithAnsi(prefix + text, width));
      return;
    }
    const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
    for (let index = 0; index < wrapped.length; index += 1) {
      lines.push((index === 0 ? prefix : " ".repeat(prefixWidth)) + wrapped[index]);
    }
  }
}
