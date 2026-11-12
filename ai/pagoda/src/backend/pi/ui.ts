import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** Preserve SDK presentation defaults while cancelling unsupported graphical interactions. */
export function piUi(
  base: ExtensionUIContext,
  notice: (message: string) => void,
): ExtensionUIContext {
  const cancelled = (method: string): void => {
    notice(
      `Pi requested a ${method} dialog. It was cancelled because this dialog is not yet supported.`,
    );
  };
  return {
    ...base,
    select: async () => {
      cancelled("select");
      return undefined;
    },
    confirm: async () => {
      cancelled("confirm");
      return false;
    },
    input: async () => {
      cancelled("input");
      return undefined;
    },
    editor: async () => {
      cancelled("editor");
      return undefined;
    },
    notify: (message) => {
      notice(message);
    },
    custom: async () => {
      cancelled("custom");
      throw new Error("Custom Pi dialogs are not supported");
    },
  };
}
