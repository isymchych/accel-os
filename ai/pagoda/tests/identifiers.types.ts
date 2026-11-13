import type {
  EntrySchema,
  HistoryEntryId,
  SessionId,
  SessionKey,
  TargetSchema,
  SessionSummary,
} from "../src/contracts/index.ts";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Assignable<A, B> = A extends B ? true : false;

export type SessionKeySchemaType = Assert<Equal<(typeof TargetSchema.Type)["key"], SessionKey>>;
export type EntrySchemaType = Assert<Equal<(typeof EntrySchema.Type)["entryId"], HistoryEntryId>>;
export type SessionIdStateType = Assert<Equal<SessionSummary["sessionId"], SessionId | null>>;
export type EntrySessionKey = Assert<Equal<(typeof EntrySchema.Type)["key"], SessionKey>>;
export type KeyRejectsSessionId = Assert<Equal<Assignable<SessionId, SessionKey>, false>>;
export type KeyRejectsEntryId = Assert<Equal<Assignable<HistoryEntryId, SessionKey>, false>>;
export type EntryRejectsKey = Assert<Equal<Assignable<SessionKey, HistoryEntryId>, false>>;
export type KeyRejectsString = Assert<Equal<Assignable<string, SessionKey>, false>>;
export type SessionRejectsString = Assert<Equal<Assignable<string, SessionId>, false>>;
export type EntryRejectsString = Assert<Equal<Assignable<string, HistoryEntryId>, false>>;
