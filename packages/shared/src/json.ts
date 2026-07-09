import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export function parseJsonWithSchema<T extends TSchema>(
  text: string,
  schema: T,
  context: string,
): Static<T> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${context}: invalid JSON syntax`, { cause: error });
  }

  assertSchema(value, schema, context);
  return value;
}

export function assertSchema<T extends TSchema>(
  value: unknown,
  schema: T,
  context: string,
): asserts value is Static<T> {
  if (Value.Check(schema, value)) {
    return;
  }

  const firstError = Value.Errors(schema, value).at(0);
  if (firstError === undefined) {
    throw new Error(`${context}: invalid JSON: schema mismatch`);
  }

  const instancePath = firstError.instancePath.length > 0 ? firstError.instancePath : "/";
  const suffix = `${instancePath} ${firstError.message}`;
  throw new Error(`${context}: invalid JSON: ${suffix}`);
}
