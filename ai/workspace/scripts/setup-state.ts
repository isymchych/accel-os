import { mkdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Build-time wiring for this pnpm workspace; saved output shares its declared dependencies.
export async function initializeState(source: string, state: string): Promise<void> {
  await mkdir(state, { recursive: true, mode: 0o700 });
  await writeFile(join(state, "package.json"), '{"type":"module"}\n');
  const dependencies = join(state, "node_modules");
  const target = resolve(source, "node_modules");
  try {
    await symlink(target, dependencies, "dir");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    // Refresh an existing dependency link when its target changes.
    // readlink rejects real files/directories rather than removing unexpected user data.
    if ((await readlink(dependencies)) !== target) {
      await unlink(dependencies);
      await symlink(target, dependencies, "dir");
    }
  }
}
