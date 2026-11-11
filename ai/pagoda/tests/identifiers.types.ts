import type { Static } from "typebox";

import type { StateSchema } from "../src/backend/protocol.ts";
import type {
  WorkspaceApi,
  EntrySchema,
  HistoryEntryId,
  SessionId,
  SessionKey,
  TargetSchema,
} from "../src/desktop-api.ts";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Assignable<A, B> = A extends B ? true : false;

export type SessionKeySchemaType = Assert<Equal<Static<typeof TargetSchema>["key"], SessionKey>>;
export type EntrySchemaType = Assert<Equal<Static<typeof EntrySchema>["entryId"], HistoryEntryId>>;
export type SessionIdStateType = Assert<Equal<Static<typeof StateSchema>["sessionId"], SessionId>>;
export type NavigateParameters = Assert<
  Equal<Parameters<WorkspaceApi["navigate"]>, [key: SessionKey, entryId: HistoryEntryId]>
>;
export type KeyRejectsSessionId = Assert<Equal<Assignable<SessionId, SessionKey>, false>>;
export type KeyRejectsEntryId = Assert<Equal<Assignable<HistoryEntryId, SessionKey>, false>>;
export type EntryRejectsKey = Assert<Equal<Assignable<SessionKey, HistoryEntryId>, false>>;
export type KeyRejectsString = Assert<Equal<Assignable<string, SessionKey>, false>>;
export type SessionRejectsString = Assert<Equal<Assignable<string, SessionId>, false>>;
export type EntryRejectsString = Assert<Equal<Assignable<string, HistoryEntryId>, false>>;
