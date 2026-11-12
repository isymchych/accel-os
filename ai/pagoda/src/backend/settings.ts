import { readFile } from "node:fs/promises";

import { Type } from "typebox";
import { Value } from "typebox/value";

const SettingsSchema = Type.Object(
  {
    sidebar: Type.Optional(
      Type.Object(
        { inactivityHours: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export async function readInactivityHours(file?: string): Promise<number> {
  if (!file) return 48;
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 48;
    throw error;
  }
  const settings: unknown = JSON.parse(contents);
  if (!Value.Check(SettingsSchema, settings)) throw new Error("Invalid Pagoda settings");
  return settings.sidebar?.inactivityHours ?? 48;
}
