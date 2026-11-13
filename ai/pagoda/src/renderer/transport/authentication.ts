import { Schema } from "effect";

import { ErrorSchema } from "../../contracts/index.ts";

async function decode(response: Response): Promise<void> {
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(Schema.is(ErrorSchema)(value) ? value.error : "Backend request failed");
  }
  if (!Schema.is(Schema.Null)(value)) throw new Error("Invalid backend response");
}

/** Exchange fragment-only bootstrap credentials for an HttpOnly cookie before mounting the app. */
export async function authenticate(): Promise<void> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token");
  if (token === null) {
    await decode(await fetch("/api/auth", { credentials: "same-origin" }));
  } else {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    await decode(
      await fetch("/api/auth", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      }),
    );
  }
}
