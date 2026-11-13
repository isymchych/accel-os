import { Effect } from "effect";
import { Atom, type AsyncResult } from "effect/reactivity";

import type { OperationError } from "../../contracts/errors.ts";
import type { Account, SessionId, StoredSession } from "../../contracts/index.ts";
import type { HttpFailure, PagodaClient } from "../transport/http-client.ts";

export interface WorkspaceRequests {
  catalog: Atom.Atom<AsyncResult.AsyncResult<readonly StoredSession[], OperationError>>;
  accounts: Atom.Atom<AsyncResult.AsyncResult<readonly Account[], OperationError>>;
  selectAccount: Atom.AtomResultFn<{ payload: { profile: string } }, null, HttpFailure>;
  metadata(
    id: SessionId,
    flag: "pinned" | "favourite",
  ): Atom.AtomResultFn<boolean, null, HttpFailure>;
}

/** Workspace-wide queries and mutations; selections and metadata remain SSE-authoritative. */
export function createWorkspaceRequests({ Client }: PagodaClient): WorkspaceRequests {
  const metadata = Atom.family((id: SessionId) =>
    Atom.family((flag: "pinned" | "favourite") =>
      Client.runtime
        .fn<boolean>()(
          Effect.fnUntraced(function* (value) {
            const client = yield* Client;
            return yield* client.workspace.metadataFlag({ payload: { id, flag, value } });
          }),
        )
        .pipe(Atom.keepAlive),
    ),
  );
  return {
    catalog: Client.query("workspace", "listAll", { payload: {} }),
    accounts: Client.query("workspace", "accounts", {}),
    selectAccount: Client.mutation("workspace", "selectAccount").pipe(Atom.keepAlive),
    metadata: (id: SessionId, flag: "pinned" | "favourite") => metadata(id)(flag),
  };
}
