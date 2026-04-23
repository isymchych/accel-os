/**
 * Personal Context Extension
 *
 * Loads untracked `AGENTS_PERSONAL.md` files by walking parent directories from
 * the current working directory and appends them to the effective system
 * prompt.
 *
 * This is useful for project-specific personal notes that should affect Pi's
 * behavior locally without being committed to the shared repository.
 */

import fs from "node:fs";
import path from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface PersonalContextFile {
  path: string;
  content: string;
}

const PERSONAL_CONTEXT_FILENAME = "AGENTS_PERSONAL.md";
const PERSONAL_CONTEXT_HEADER =
  "\n\n# Personal Project Context\n\nLocal untracked instructions for this machine:\n\n";

function loadPersonalContextFile(dirPath: string): PersonalContextFile | null {
  const filePath = path.join(dirPath, PERSONAL_CONTEXT_FILENAME);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  return {
    path: filePath,
    content: fs.readFileSync(filePath, "utf8"),
  };
}

function discoverPersonalContextFiles(cwd: string): PersonalContextFile[] {
  const discovered: PersonalContextFile[] = [];
  const seenPaths = new Set<string>();
  let currentDir = path.resolve(cwd);
  const rootDir = path.parse(currentDir).root;
  let keepWalking = true;

  while (keepWalking) {
    const contextFile = loadPersonalContextFile(currentDir);
    if (contextFile && !seenPaths.has(contextFile.path)) {
      discovered.unshift(contextFile);
      seenPaths.add(contextFile.path);
    }

    if (currentDir === rootDir) {
      keepWalking = false;
      continue;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      keepWalking = false;
      continue;
    }
    currentDir = parentDir;
  }

  return discovered;
}

function buildPersonalContextSection(contextFiles: PersonalContextFile[]): string {
  const blocks = contextFiles.map(
    (contextFile) => `## ${contextFile.path}\n\n${contextFile.content}\n\n`,
  );
  return `${PERSONAL_CONTEXT_HEADER}${blocks.join("")}`;
}

export default function personalContext(pi: ExtensionAPI): void {
  let cachedContextFiles: PersonalContextFile[] = [];

  pi.on("session_start", async (_event, ctx) => {
    cachedContextFiles = discoverPersonalContextFiles(ctx.cwd);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (cachedContextFiles.length === 0) {
      cachedContextFiles = discoverPersonalContextFiles(ctx.cwd);
    }

    if (cachedContextFiles.length === 0) {
      return undefined;
    }

    return {
      systemPrompt: `${ctx.getSystemPrompt()}${buildPersonalContextSection(cachedContextFiles)}`,
    };
  });
}
