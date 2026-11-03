import { Type, type Static } from "typebox";

export const ReloadRequestSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9-]+$" }),
  },
  { additionalProperties: false },
);

export const ReloadStatusSchema = Type.Object(
  {
    // Launcher identity; retain the wire name across the supervisor refactor.
    ownerId: Type.String(),
    // Selected for the next startup.
    savedVersion: Type.String(),
    // Currently serving UI/API; null when the API is unavailable.
    servingVersion: Type.Union([Type.String(), Type.Null()]),
    operationId: Type.Union([Type.String(), Type.Null()]),
    phase: Type.Union([
      Type.Literal("idle"),
      Type.Literal("checking"),
      Type.Literal("building"),
      Type.Literal("activating"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
    ]),
    message: Type.String(),
  },
  { additionalProperties: false },
);

export type ReloadStatus = Static<typeof ReloadStatusSchema>;

export const ReloadResultSchema = Type.Object(
  { accepted: Type.Boolean(), status: ReloadStatusSchema },
  { additionalProperties: false },
);
export type ReloadResult = Static<typeof ReloadResultSchema>;

export type ReloadControl = {
  status: () => Promise<ReloadStatus>;
  reload: (requestId: string) => Promise<ReloadResult>;
};
