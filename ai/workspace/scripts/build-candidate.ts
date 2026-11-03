import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { build } from "vite";

import { applicationPaths, type Artifact } from "../launcher/artifacts.ts";

const source = resolve(import.meta.dirname, "..");

// Produce output only. The caller owns candidate creation, activation, and publication.
export async function buildCandidate(candidate: Artifact): Promise<void> {
  await compile("server/tsconfig.api-build.json", candidate.directory);
  await build({
    root: source,
    build: { outDir: applicationPaths(candidate.directory).clientDirectory, emptyOutDir: true },
    define: { __BUILD_ID__: JSON.stringify(candidate.id) },
  });
}

export async function buildLauncher(output: string): Promise<void> {
  await compile("launcher/tsconfig.build.json", output);
}

async function compile(config: string, output: string): Promise<void> {
  await new Promise<void>((resolveCompile, reject) => {
    const command = spawn("tsc", ["--project", resolve(source, config), "--outDir", output], {
      cwd: source,
      stdio: "inherit",
    });
    command.once("error", reject);
    command.once("exit", (code) => {
      if (code === 0) resolveCompile();
      else reject(new Error(`Backend build failed: ${config}.`));
    });
  });
}
