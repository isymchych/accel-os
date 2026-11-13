import { Schema as S } from "effect";
import { HttpClientError } from "effect/http";

import { ErrorSchema } from "../contracts/index.ts";

/** Preserve application rejections and distinguish lost command acknowledgements. */
export function requestError(error: unknown): Error {
  if (S.is(ErrorSchema)(error)) return new Error(error.error);
  if (
    HttpClientError.isHttpClientError(error) &&
    error.reason instanceof HttpClientError.TransportError
  )
    return new Error(
      "Backend connection lost. The command outcome is uncertain; it was not retried.",
    );
  return new Error("Backend request failed");
}
