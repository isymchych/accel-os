/**
 * Draft Stash Extension
 *
 * Keeps a small in-memory stack of editor drafts for the current Pi runtime.
 * `alt+s` stashes the current editor text when present, otherwise opens the
 * stash picker. `/stash` always opens the picker.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import {
  countLines,
  getGlobalDraftStack,
  previewDraft,
  pushDraft,
  removeDraft,
  setGlobalDraftStack,
  type DraftItem,
  type DraftStack,
} from "./stack.ts";

const STATUS_KEY = "draft-stash";
const SHORTCUT = "alt+s";

function hasEditorDraft(text: string): boolean {
  return text.trim().length > 0;
}

function getEditorText(ctx: ExtensionContext): string {
  return ctx.ui.getEditorText();
}

function updateStatus(ctx: ExtensionContext, stack: DraftStack): void {
  if (stack.items.length === 0) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `stash:${stack.items.length}`));
}

function restoreDraft(ctx: ExtensionContext, item: DraftItem): void {
  ctx.ui.setEditorText(item.text);
  ctx.ui.notify(`Restored draft (${countLines(item.text)} lines)`, "info");
}

function ensureRestorableEditor(ctx: ExtensionContext): boolean {
  if (hasEditorDraft(getEditorText(ctx))) {
    ctx.ui.notify("Editor is not empty. Stash or clear it before restoring.", "warning");
    return false;
  }

  return true;
}

function toSelectItems(stack: DraftStack): SelectItem[] {
  return stack.items.map<SelectItem>((item) => ({
    value: String(item.id),
    label: previewDraft(item.text),
    description: `${countLines(item.text)} lines`,
  }));
}

function frameLines(
  lines: readonly string[],
  width: number,
  color: (text: string) => string,
): string[] {
  const innerWidth = Math.max(1, width - 4);
  const top = color(`┌${"─".repeat(Math.max(0, width - 2))}┐`);
  const bottom = color(`└${"─".repeat(Math.max(0, width - 2))}┘`);

  const framed = lines.map((line) => {
    const trimmed = truncateToWidth(line, innerWidth, "");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
    return `${color("│ ")}${trimmed}${padding}${color(" │")}`;
  });

  return [top, ...framed, bottom];
}

async function pickDraft(
  ctx: ExtensionContext,
  initialStack: DraftStack,
  onStackChange: (stack: DraftStack) => void,
): Promise<{ stack: DraftStack; selectedId: number | null }> {
  if (initialStack.items.length === 0) {
    await ctx.ui.custom<undefined>(
      (_tui, theme, _kb, done) => ({
        render: (width: number): string[] =>
          frameLines(
            [
              theme.fg("accent", theme.bold("Draft Stash")),
              "",
              "No stashed drafts.",
              "",
              theme.fg("dim", "Enter/Esc close"),
            ],
            width,
            (text: string): string => theme.fg("accent", text),
          ),
        invalidate: (): void => {},
        handleInput: (data: string): void => {
          if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
            done(undefined);
          }
        },
      }),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: 72,
          maxHeight: "70%",
        },
      },
    );

    return { stack: initialStack, selectedId: null };
  }

  let workingStack = initialStack;
  let selectedDraftId = workingStack.items[0]?.id ?? null;

  const pickedValue = await ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      const helpText = theme.fg("dim", "↑↓ navigate • enter restore • del remove • esc cancel");

      function createSelectList(items: SelectItem[], preferredId?: number | null): SelectList {
        const nextList = new SelectList(items, Math.min(Math.max(items.length, 1), 10), {
          selectedPrefix: (text): string => theme.fg("accent", text),
          selectedText: (text): string => theme.fg("accent", text),
          description: (text): string => theme.fg("muted", text),
          scrollInfo: (text): string => theme.fg("dim", text),
          noMatch: (text): string => theme.fg("warning", text),
        });
        nextList.onSelectionChange = (item): void => {
          selectedDraftId = Number(item.value);
        };

        const initialSelectedId = preferredId ?? selectedDraftId;
        if (initialSelectedId !== null) {
          const selectedIndex = items.findIndex((item) => Number(item.value) === initialSelectedId);
          if (selectedIndex >= 0) {
            nextList.setSelectedIndex(selectedIndex);
          }
        }

        const current = nextList.getSelectedItem();
        selectedDraftId = current === null ? null : Number(current.value);
        return nextList;
      }

      let list = createSelectList(toSelectItems(workingStack));

      list.onSelect = (item): void => done(item.value);
      list.onCancel = (): void => done(null);

      return {
        render: (width: number): string[] => {
          const innerWidth = Math.max(1, width - 4);
          return frameLines(
            [theme.fg("accent", theme.bold("Draft Stash")), ...list.render(innerWidth), helpText],
            width,
            (text: string): string => theme.fg("accent", text),
          );
        },
        invalidate: (): void => list.invalidate(),
        handleInput: (data: string): void => {
          if (matchesKey(data, Key.delete)) {
            const current = list.getSelectedItem();
            if (current === null) {
              return;
            }

            const currentId = Number(current.value);
            const currentIndex = workingStack.items.findIndex((item) => item.id === currentId);
            const result = removeDraft(workingStack, currentId);
            if (result.item === undefined) {
              return;
            }

            workingStack = result.stack;
            onStackChange(workingStack);
            ctx.ui.notify(`Stash now has ${workingStack.items.length} drafts`, "info");
            if (workingStack.items.length === 0) {
              done(null);
              return;
            }

            const nextIndex = Math.min(currentIndex, workingStack.items.length - 1);
            const nextSelectedId = workingStack.items[nextIndex]?.id ?? null;
            list = createSelectList(toSelectItems(workingStack), nextSelectedId);
            list.onSelect = (item): void => done(item.value);
            list.onCancel = (): void => done(null);
            tui.requestRender();
            return;
          }

          list.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 72,
        maxHeight: "70%",
      },
    },
  );

  return {
    stack: workingStack,
    selectedId: pickedValue === null ? null : Number(pickedValue),
  };
}

export default function draftStash(pi: ExtensionAPI): void {
  let stack = getGlobalDraftStack();

  const syncStack = (nextStack: DraftStack): DraftStack => {
    stack = setGlobalDraftStack(nextStack);
    return stack;
  };

  const stashEditor = (ctx: ExtensionContext): boolean => {
    const text = getEditorText(ctx);
    if (!hasEditorDraft(text)) {
      return false;
    }

    syncStack(pushDraft(stack, text));
    ctx.ui.setEditorText("");
    updateStatus(ctx, stack);
    ctx.ui.notify(`Stashed draft (${stack.items.length} total)`, "info");
    return true;
  };

  pi.on("session_start", async (_event, ctx) => {
    stack = getGlobalDraftStack();
    updateStatus(ctx, stack);
  });

  pi.registerShortcut(SHORTCUT, {
    description: "Stash the current draft or open the draft picker",
    handler: async (ctx) => {
      if (stashEditor(ctx)) {
        return;
      }

      if (!ensureRestorableEditor(ctx)) {
        return;
      }

      const result = await pickDraft(ctx, stack, (nextStack) => {
        syncStack(nextStack);
        updateStatus(ctx, stack);
      });
      syncStack(result.stack);
      updateStatus(ctx, stack);

      if (result.selectedId === null) {
        return;
      }

      const restored = removeDraft(stack, result.selectedId);
      if (restored.item === undefined) {
        ctx.ui.notify("Selected draft is no longer available", "warning");
        return;
      }

      syncStack(restored.stack);
      updateStatus(ctx, stack);
      restoreDraft(ctx, restored.item);
    },
  });

  pi.registerCommand("stash", {
    description: "Open the in-memory draft stash picker",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/stash requires interactive mode", "error");
        return;
      }

      if (!ensureRestorableEditor(ctx)) {
        return;
      }

      const result = await pickDraft(ctx, stack, (nextStack) => {
        syncStack(nextStack);
        updateStatus(ctx, stack);
      });
      syncStack(result.stack);
      updateStatus(ctx, stack);

      if (result.selectedId === null) {
        return;
      }

      const restored = removeDraft(stack, result.selectedId);
      if (restored.item === undefined) {
        ctx.ui.notify("Selected draft is no longer available", "warning");
        return;
      }

      syncStack(restored.stack);
      updateStatus(ctx, stack);
      restoreDraft(ctx, restored.item);
    },
  });
}
