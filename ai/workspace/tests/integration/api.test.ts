import assert from "node:assert/strict";
import test from "node:test";

import { api } from "../../server/app/api.ts";

test("health endpoint reports readiness", async () => {
  const response = await api.request("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("diagnostic endpoint accepts schema-valid JSON", async () => {
  const response = await api.request("/api/diagnostic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hello" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { echo: "hello" });
});

test("diagnostic endpoint rejects malformed JSON", async () => {
  const response = await api.request("/api/diagnostic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Malformed JSON in request body");
});

test("diagnostic endpoint rejects schema-invalid JSON", async () => {
  const response = await api.request("/api/diagnostic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "invalid_request",
    message: "Request body must contain a non-empty message of at most 200 characters.",
  });
});
