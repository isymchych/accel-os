import { Dialog } from "@base-ui/react/dialog";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { KeyboardIcon } from "lucide-react";
import { useState, type ReactElement, type RefObject } from "react";

import type { SessionKey } from "../desktop-api.ts";
import { Button } from "./components/ui/button.tsx";

export function WorkspaceNavigation({
  target,
  composer,
  transcript,
  sessionKeys,
  selected,
  onSelect,
}: {
  target: RefObject<HTMLElement | null>;
  composer: RefObject<HTMLTextAreaElement | null>;
  transcript: RefObject<HTMLDivElement | null>;
  sessionKeys: SessionKey[];
  selected: SessionKey | null;
  onSelect: (key: SessionKey) => void;
}): ReactElement {
  const [helpOpen, setHelpOpen] = useState(false);
  function switchSession(direction: number): void {
    const index = selected === null ? -1 : sessionKeys.indexOf(selected);
    const next = sessionKeys[index + direction];
    if (index >= 0 && next) onSelect(next);
  }
  const shortcuts: (UseHotkeyDefinition & { label: string; description: string })[] = [
    {
      hotkey: "J",
      label: "j",
      description: "Scroll down",
      callback: () => {
        transcript.current?.scrollBy({ top: 80 });
      },
      options: { requireReset: false },
    },
    {
      hotkey: "K",
      label: "k",
      description: "Scroll up",
      callback: () => {
        transcript.current?.scrollBy({ top: -80 });
      },
      options: { requireReset: false },
    },
    {
      hotkey: "Control+D",
      label: "Ctrl+d",
      description: "Half-page down",
      callback: () => {
        if (transcript.current)
          transcript.current.scrollBy({ top: transcript.current.clientHeight / 2 });
      },
    },
    {
      hotkey: "Control+U",
      label: "Ctrl+u",
      description: "Half-page up",
      callback: () => {
        if (transcript.current)
          transcript.current.scrollBy({ top: -transcript.current.clientHeight / 2 });
      },
    },
    {
      hotkey: ["G", "G"],
      label: "gg",
      description: "Page start",
      callback: () => {
        transcript.current?.scrollTo({ top: 0 });
      },
    },
    {
      hotkey: "Shift+G",
      label: "G",
      description: "Page end",
      callback: () => {
        if (transcript.current)
          transcript.current.scrollTo({ top: transcript.current.scrollHeight });
      },
    },
    {
      hotkey: "I",
      label: "i",
      description: "Focus message input",
      callback: () => composer.current?.focus(),
    },
    {
      hotkey: "[",
      label: "[",
      description: "Previous open session",
      callback: () => {
        switchSession(-1);
      },
    },
    {
      hotkey: "]",
      label: "]",
      description: "Next open session",
      callback: () => {
        switchSession(1);
      },
    },
    {
      hotkey: "Shift+/",
      label: "?",
      description: "Show keyboard shortcuts",
      callback: () => {
        setHelpOpen(true);
      },
    },
  ];
  useHotkeys(shortcuts, {
    target,
    enabled: !helpOpen,
    ignoreInputs: true,
    ignoreDefaultPrevented: true,
  });

  return (
    <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
          />
        }
      >
        <KeyboardIcon aria-hidden="true" />
        Keyboard shortcuts
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-border bg-popover p-6 text-popover-foreground shadow-md">
          <Dialog.Title className="text-lg font-semibold">Keyboard shortcuts</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            Navigation shortcuts are inactive while typing or using a menu or dialog.
          </Dialog.Description>
          <dl className="my-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {shortcuts.map(({ label, description }) => (
              <div key={label} className="contents">
                <dt>
                  <kbd>{label}</kbd>
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Leave message input or close this help; never stop the agent</dd>
          </dl>
          <Dialog.Close render={<Button variant="outline" />}>Close</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
