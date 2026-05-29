export interface DraftItem {
  id: number;
  text: string;
}

export interface DraftStack {
  items: DraftItem[];
  nextId: number;
}

export interface DraftMutationResult {
  stack: DraftStack;
  item: DraftItem | undefined;
}

const GLOBAL_STACK_KEY = "__accelOsPiDraftStashStack";

type DraftStackGlobal = typeof globalThis & {
  [GLOBAL_STACK_KEY]?: DraftStack;
};

export function createDraftStack(): DraftStack {
  return {
    items: [],
    nextId: 1,
  };
}

export function getGlobalDraftStack(): DraftStack {
  const draftStackGlobal = globalThis as DraftStackGlobal;
  const existing = draftStackGlobal[GLOBAL_STACK_KEY];
  if (existing !== undefined) {
    return existing;
  }

  const stack = createDraftStack();
  draftStackGlobal[GLOBAL_STACK_KEY] = stack;
  return stack;
}

export function setGlobalDraftStack(stack: DraftStack): DraftStack {
  const draftStackGlobal = globalThis as DraftStackGlobal;
  draftStackGlobal[GLOBAL_STACK_KEY] = stack;
  return stack;
}

export function resetGlobalDraftStack(): void {
  setGlobalDraftStack(createDraftStack());
}

export function pushDraft(stack: DraftStack, text: string): DraftStack {
  return {
    items: [{ id: stack.nextId, text }, ...stack.items],
    nextId: stack.nextId + 1,
  };
}

export function popDraft(stack: DraftStack): DraftMutationResult {
  const [item, ...rest] = stack.items;
  return {
    stack: {
      items: rest,
      nextId: stack.nextId,
    },
    item,
  };
}

export function removeDraft(stack: DraftStack, id: number): DraftMutationResult {
  const item = stack.items.find((candidate) => candidate.id === id);
  if (item === undefined) {
    return { stack, item: undefined };
  }

  return {
    stack: {
      items: stack.items.filter((candidate) => candidate.id !== id),
      nextId: stack.nextId,
    },
    item,
  };
}

export function previewDraft(text: string): string {
  const preview = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return preview ?? "(empty draft)";
}

export function countLines(text: string): number {
  return Math.max(1, text.split(/\r\n|\r|\n/).length);
}
