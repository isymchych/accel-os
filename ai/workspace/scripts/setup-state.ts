import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Build-time wiring for this npm workspace; saved output shares checkout dependencies.
export async function initializeState(source: string, state: string): Promise<void> {
  await mkdir(state, { recursive: true, mode: 0o700 });
  await writeFile(join(state, "package.json"), '{"type":"module"}\n');
  try {
    await symlink(resolve(source, "../../node_modules"), join(state, "node_modules"), "dir");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
}
