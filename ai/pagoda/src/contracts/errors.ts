import { Schema } from "effect";

import { ErrorSchema } from "./index.ts";

/** A command or resource selection rejected at an application or SDK boundary. */
export class OperationRejected extends Schema.Error<OperationRejected>("OperationRejected")(
  ErrorSchema,
  { httpApiStatus: 400 },
) {
  public readonly _tag = "OperationRejected";

  public override get message(): string {
    return this.error;
  }
}

/** An operation that failed rather than rejecting the user's request. */
export class OperationFailed extends Schema.Error<OperationFailed>("OperationFailed")(ErrorSchema, {
  httpApiStatus: 500,
}) {
  public readonly _tag = "OperationFailed";

  public override get message(): string {
    return this.error;
  }
}

export type OperationError = OperationRejected | OperationFailed;
