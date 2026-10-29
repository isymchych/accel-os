import { Hono } from "hono";
import { validator } from "hono/validator";
import { Value } from "typebox/value";

import { DiagnosticRequestSchema } from "../../contracts/diagnostics.ts";

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

export const api = new Hono()
  .get("/api/health", (context) => context.json({ status: "ok" }))
  .post("/api/diagnostic", diagnosticValidator, (context) => {
    const { message } = context.req.valid("json");
    return context.json({ echo: message });
  });

export type Api = typeof api;
