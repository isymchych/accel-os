import { Cause, Data, Schema } from "effect";
import { HttpClientError } from "effect/http";
import { AsyncResult } from "effect/reactivity";

import { OperationFailed, OperationRejected, type OperationError } from "../../contracts/errors.ts";

/** Retain failure meaning until the UI chooses read- or command-specific feedback. */
export class ClientFailure extends Data.TaggedError("ClientFailure")<{
  kind: "transport" | "invalid-response" | "unexpected";
  cause: unknown;
}> {}

export type ClientError = OperationError | ClientFailure;

export function clientError(error: unknown): ClientError {
  if (
    error instanceof OperationRejected ||
    error instanceof OperationFailed ||
    error instanceof ClientFailure
  )
    return error;
  if (HttpClientError.isHttpClientError(error)) {
    return new ClientFailure({
      kind:
        error.reason instanceof HttpClientError.TransportError
          ? "transport"
          : error.reason instanceof HttpClientError.DecodeError
            ? "invalid-response"
            : "unexpected",
      cause: error,
    });
  }
  return new ClientFailure({
    kind: Schema.isSchemaError(error) ? "invalid-response" : "unexpected",
    cause: error,
  });
}

export function errorMessage(error: unknown, command = true): string {
  const failure = clientError(error);
  if (!(failure instanceof ClientFailure)) return failure.message;
  if (failure.kind === "transport")
    return command
      ? "Backend connection lost. The command outcome is uncertain; it was not retried."
      : "Backend connection lost. Could not load data.";
  if (failure.kind === "invalid-response")
    return command
      ? "Invalid backend response. The command outcome is uncertain; it was not retried."
      : "Invalid backend response.";
  return "Backend request failed";
}

export function requestFeedback<A, E>(
  result: AsyncResult.AsyncResult<A, E>,
  command = false,
): string | null {
  return AsyncResult.isFailure(result) && !result.waiting
    ? errorMessage(Cause.squash(result.cause), command)
    : null;
}
