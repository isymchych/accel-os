import { OperationFailed, OperationRejected, type OperationError } from "../contracts/errors.ts";

export { OperationFailed, OperationRejected, type OperationError };

/** Normalize external failures without erasing an already classified rejection or its cause. */
export function operationError(cause: unknown): OperationError {
  if (cause instanceof OperationRejected || cause instanceof OperationFailed) return cause;
  return Object.assign(
    new OperationFailed({ error: cause instanceof Error ? cause.message : "Operation failed" }),
    { cause },
  );
}
