import type { Static, TSchema } from "typebox";

import { assertSchema } from "./json.ts";

const fetchJson = async (url: string | URL, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return await response.json();
};

export const fetchJsonWithSchema = async <Schema extends TSchema>(
  url: string | URL,
  schema: Schema,
  context: string,
  init?: RequestInit,
): Promise<Static<Schema>> => {
  const data = await fetchJson(url, init);
  assertSchema(data, schema, context);
  return data;
};
