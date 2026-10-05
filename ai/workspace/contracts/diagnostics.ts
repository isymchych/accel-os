import type { Static } from "typebox";
import { Type } from "typebox";

export const DiagnosticRequestSchema = Type.Object(
  {
    message: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

export type DiagnosticRequest = Static<typeof DiagnosticRequestSchema>;

export const DiagnosticResponseSchema = Type.Object(
  {
    echo: Type.String(),
  },
  { additionalProperties: false },
);

export type DiagnosticResponse = Static<typeof DiagnosticResponseSchema>;

export const ApiErrorSchema = Type.Object(
  {
    code: Type.Literal("invalid_request"),
    message: Type.String(),
  },
  { additionalProperties: false },
);

export type ApiError = Static<typeof ApiErrorSchema>;
