import { Type, type Static } from "typebox";

import { ReloadResultSchema, ReloadStatusSchema } from "./reload.ts";

export const SupervisorRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("status"), id: Type.String() }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("reload"), id: Type.String(), requestId: Type.String() },
    { additionalProperties: false },
  ),
]);
export type SupervisorRequest = Static<typeof SupervisorRequestSchema>;

export const SupervisorResponseSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("status-result"), id: Type.String(), status: ReloadStatusSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("reload-result"), id: Type.String(), result: ReloadResultSchema },
    { additionalProperties: false },
  ),
]);
export type SupervisorResponse = Static<typeof SupervisorResponseSchema>;
