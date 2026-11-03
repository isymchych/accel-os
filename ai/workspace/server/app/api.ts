import { Hono } from "hono";
import { validator } from "hono/validator";
import { Value } from "typebox/value";

import { DiagnosticRequestSchema } from "../../contracts/diagnostics.ts";
import { ReloadRequestSchema, type ReloadControl } from "../../contracts/reload.ts";

const diagnosticValidator = validator("json", (value: unknown, context) => {
  if (!Value.Check(DiagnosticRequestSchema, value)) {
    return context.json(
      {
        code: "invalid_request",
        message: "Request body must contain a non-empty message of at most 200 characters.",
      },
      400,
    );
  }

  return value;
});

// oxlint-disable-next-line typescript/explicit-module-boundary-types, typescript/explicit-function-return-type -- Hono RPC requires the inferred route schema.
export function createApi(control?: ReloadControl) {
  return new Hono()
    .get("/api/health", (context) => context.json({ status: "ok" }))
    .get("/api/reload", async (context) => {
      if (control === undefined) return context.json({ code: "owner_unavailable" }, 503);
      return context.json(await control.status());
    })
    .post(
      "/api/reload",
      validator("json", (value: unknown, context) => {
        if (!Value.Check(ReloadRequestSchema, value)) {
          return context.json(
            { code: "invalid_request", message: "A valid request ID is required." },
            400,
          );
        }
        return value;
      }),
      async (context) => {
        if (control === undefined) return context.json({ code: "owner_unavailable" }, 503);
        const result = await control.reload(context.req.valid("json").requestId);
        return context.json(result.status, result.accepted ? 202 : 409);
      },
    )
    .post("/api/diagnostic", diagnosticValidator, (context) => {
      const { message } = context.req.valid("json");
      return context.json({ echo: message });
    });
}

export const api = createApi();
export type Api = typeof api;
