import { readFile } from "node:fs/promises";

import { Schema } from "effect";

const SettingsSchema = Schema.Struct({
  sidebar: Schema.optionalKey(
    Schema.Struct({
      inactivityHours: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
    }),
  ),
});
const decodeSettings = Schema.decodeUnknownSync(SettingsSchema, { onExcessProperty: "error" });

export async function readInactivityHours(file?: string): Promise<number> {
  if (!file) return 48;
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 48;
    throw error;
  }
  const value: unknown = JSON.parse(contents);
  let settings: typeof SettingsSchema.Type;
  try {
    settings = decodeSettings(value);
  } catch {
    throw new Error("Invalid Pagoda settings");
  }
  return settings.sidebar?.inactivityHours ?? 48;
}
