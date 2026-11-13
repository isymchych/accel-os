import { Effect } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";

import type {
  HistoryEntryId,
  SessionKey,
  SessionSnapshot,
  WorkspaceEvents,
} from "../../contracts/index.ts";
import { createComposerAtoms, type ComposerAtoms } from "../session/composer-state.ts";
import { createSessionState, type SessionState } from "../session/session-state.ts";
import { createHttpClient, type Command, type PagodaClient } from "../transport/http-client.ts";
import { createWorkspaceRequests, type WorkspaceRequests } from "../workspace/requests.ts";
import { createWorkspaceAtoms, type WorkspaceAtoms } from "../workspace/workspace-state.ts";

export interface AppModel {
  workspace: WorkspaceAtoms;
  requests: WorkspaceRequests;
  sessions: SessionState;
  composers: ComposerAtoms;
  draftOwners: Atom.Atom<readonly SessionKey[]>;
  storage: Storage;
  directory(cwd: string): Command<string>;
  create(cwd: string): Command<SessionSnapshot>;
  open(cwd: string, path: string): Command<SessionSnapshot>;
  fork(key: SessionKey, entryId: HistoryEntryId): Command<SessionSnapshot>;
}

/** Stable model definitions for one authenticated client; values live in its registry. */
export function createAppModel(
  events: WorkspaceEvents,
  storage: Storage,
  http: PagodaClient = createHttpClient(window.location.origin),
): AppModel {
  const requests = createWorkspaceRequests(http);
  const sessions = createSessionState(http);
  const workspace = createWorkspaceAtoms(events, requests, sessions);
  const composers = createComposerAtoms(storage, sessions.prompt);

  const ingest = Effect.fnUntraced(function* (snapshot: SessionSnapshot) {
    const registry = yield* AtomRegistry.AtomRegistry;
    workspace.receive(registry, { type: "snapshot", snapshot });
    return snapshot;
  });

  return {
    workspace,
    requests,
    sessions,
    composers,
    draftOwners: Atom.make((get) =>
      get(workspace.summaries)
        .filter((session) => get(composers(session.key).hasDraft))
        .map((session) => session.key),
    ).pipe(
      Atom.withEquality(
        (a: SessionKey[], b: SessionKey[]) =>
          a.length === b.length && a.every((key, index) => key === b[index]),
      ),
    ),
    storage,
    directory: (cwd: string) =>
      http.request((client) => client.workspace.directory({ payload: { cwd } })),
    create: (cwd: string) =>
      http
        .request((client) => client.workspace.create({ payload: { cwd } }))
        .pipe(Effect.flatMap(ingest)),
    open: (cwd: string, path: string) =>
      http
        .request((client) => client.workspace.open({ payload: { cwd, path } }))
        .pipe(Effect.flatMap(ingest)),
    fork: (key: SessionKey, entryId: HistoryEntryId) =>
      sessions.fork(key, entryId).pipe(Effect.flatMap(ingest)),
  };
}
