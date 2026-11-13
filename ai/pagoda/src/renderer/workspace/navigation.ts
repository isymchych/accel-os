import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import type { HistoryEntryId, SessionKey, SessionSnapshot } from "../../contracts/index.ts";
import { useAppModel, useRunCommand } from "../app/app-provider.tsx";
import { errorMessage } from "../transport/errors.ts";
import type { Command } from "../transport/http-client.ts";

export interface WorkspaceNavigationState {
  selected: SessionKey | null;
  directory: string;
  directoryInput: string;
  setDirectoryInput(value: string): void;
  library: boolean;
  opening: boolean;
  feedback: string | null;
  select(key: SessionKey): void;
  browse(): void;
  fork: (key: SessionKey, entryId: HistoryEntryId) => Promise<void>;
  validateDirectory(): Promise<void>;
  create(): Promise<void>;
  open(cwd: string, path: string): Promise<void>;
}

/** Client-local navigation; late command results are ingested without stealing the selected view. */
export function useWorkspaceNavigation(): WorkspaceNavigationState {
  const model = useAppModel();
  const run = useRunCommand();
  const initial = useAtomValue(model.workspace.initial);
  const refreshCatalog = useAtomRefresh(model.requests.catalog);
  const revision = useRef(0);
  const [selected, setSelected] = useState<SessionKey | null>(null);
  const [directory, setDirectory] = useState("");
  const [directoryInput, setDirectoryInput] = useState("");
  const [library, setLibrary] = useState(false);
  const [opening, setOpening] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    const previous = model.storage.getItem("pi-selected");
    const key =
      initial.sessions.find((session) => session.key === previous)?.key ?? initial.initialKey;
    const cwd = initial.sessions.find((session) => session.key === key)?.cwd ?? "";
    // Restore client navigation from the external workspace's reconnect snapshot.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelected(key);
    setDirectory(cwd);
    setDirectoryInput(cwd);
  }, [initial, model]);
  useEffect(() => {
    if (selected !== null) model.storage.setItem("pi-selected", selected);
  }, [selected, model]);

  function select(key: SessionKey): void {
    revision.current += 1;
    setSelected(key);
    setLibrary(false);
  }
  function browse(): void {
    revision.current += 1;
    setLibrary(true);
    refreshCatalog();
  }
  async function open(operation: Command<SessionSnapshot>): Promise<void> {
    revision.current += 1;
    const started = revision.current;
    setOpening(true);
    setFeedback(null);
    try {
      const next = await run(operation);
      if (started === revision.current) {
        setSelected(next.key);
        setLibrary(false);
      }
    } catch (error) {
      setFeedback(errorMessage(error));
    }
    setOpening(false);
  }
  async function fork(key: SessionKey, entryId: HistoryEntryId): Promise<void> {
    revision.current += 1;
    const started = revision.current;
    const next = await run(model.fork(key, entryId));
    if (started === revision.current) setSelected(next.key);
  }
  async function validateDirectory(): Promise<void> {
    try {
      const cwd = await run(model.directory(directoryInput));
      setDirectory(cwd);
      setDirectoryInput(cwd);
      setFeedback(null);
    } catch (error) {
      setFeedback(errorMessage(error));
    }
  }
  return {
    selected,
    directory,
    directoryInput,
    setDirectoryInput,
    library,
    opening,
    feedback,
    select,
    browse,
    fork,
    validateDirectory,
    create: () => open(model.create(directory)),
    open: (cwd: string, path: string) => open(model.open(cwd, path)),
  };
}
