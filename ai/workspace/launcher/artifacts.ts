import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type Artifact = { id: string; directory: string };

export function stateDirectory(source: string): string {
  return resolve(process.env["WORKSPACE_STATE_DIR"] ?? join(source, ".workspace"));
}

export function applicationPaths(directory: string): {
  entrypoint: string;
  clientDirectory: string;
} {
  return {
    entrypoint: join(directory, "server/app/main.js"),
    clientDirectory: join(directory, "dist"),
  };
}

async function currentSlot(state: string): Promise<"a" | "b" | undefined> {
  let slot: string;
  try {
    slot = (await readFile(join(state, "current"), "utf8")).trim();
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  if (slot !== "a" && slot !== "b")
    throw new Error("Unsupported saved application layout. Use a fresh WORKSPACE_STATE_DIR.");
  return slot;
}

export async function prepareArtifact(state: string, id: string = randomUUID()): Promise<Artifact> {
  const slot = (await currentSlot(state)) === "a" ? "b" : "a";
  const directory = join(state, slot);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "version"), id);
  return { id, directory };
}

export async function readArtifact(state: string): Promise<Artifact> {
  const slot = await currentSlot(state);
  if (slot === undefined) throw new Error("No built application. Run npm run build first.");
  const directory = join(state, slot);
  const id = (await readFile(join(directory, "version"), "utf8")).trim();
  const paths = applicationPaths(directory);
  await readFile(join(paths.clientDirectory, "index.html"));
  await readFile(paths.entrypoint);
  return { id, directory };
}

// Two reusable output slots share an atomically replaced startup pointer.
export async function publishArtifact(state: string, artifact: Artifact): Promise<void> {
  const slot = artifact.directory === join(state, "a") ? "a" : "b";
  if (artifact.directory !== join(state, slot)) throw new Error("Invalid application slot.");
  const temporary = join(state, "current.next");
  await writeFile(temporary, slot, { mode: 0o600 });
  try {
    await rename(temporary, join(state, "current"));
  } finally {
    await rm(temporary, { force: true });
  }
}

// The pointer is the commit boundary. An interrupted attempt never replaces current.
// Startup removes unfinished candidates; successful activation removes superseded output.
export async function discardCandidate(state: string): Promise<void> {
  const slot = await currentSlot(state);
  for (const name of ["a", "b"]) {
    if (name !== slot) await rm(join(state, name), { recursive: true, force: true });
  }
  await rm(join(state, "current.next"), { recursive: true, force: true });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
