const draftKey = "workspace.diagnostic.draft";

export function readDraft(fallback: string): string {
  try {
    return sessionStorage.getItem(draftKey) ?? fallback;
  } catch {
    return fallback;
  }
}

export function preserveDraft(message: string): boolean {
  try {
    sessionStorage.setItem(draftKey, message);
    return true;
  } catch {
    return false;
  }
}
