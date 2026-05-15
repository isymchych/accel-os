import {
  access as fsAccess,
  mkdir,
  readFile as fsReadFile,
  rename as fsRename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export interface Workspace {
  readText: (absolutePath: string) => Promise<string>;
  writeText: (absolutePath: string, content: string) => Promise<void>;
  deleteFile: (absolutePath: string) => Promise<void>;
  renameFile: (fromPath: string, toPath: string) => Promise<void>;
  exists: (absolutePath: string) => Promise<boolean>;
}

async function writeFileAtomic(absolutePath: string, content: string): Promise<void> {
  const tempPath = `${absolutePath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await fsWriteFile(tempPath, content, "utf-8");
  try {
    await fsRename(tempPath, absolutePath);
  } catch {
    await fsUnlink(absolutePath).catch(() => undefined);
    await fsRename(tempPath, absolutePath);
  }
}

export function createRealWorkspace(): Workspace {
  return {
    readText: async (absolutePath: string) => fsReadFile(absolutePath, "utf-8"),
    writeText: async (absolutePath: string, content: string) =>
      writeFileAtomic(absolutePath, content),
    deleteFile: async (absolutePath: string) => fsUnlink(absolutePath),
    renameFile: async (fromPath: string, toPath: string) => {
      await mkdir(dirname(toPath), { recursive: true });
      await fsRename(fromPath, toPath);
    },
    exists: async (absolutePath: string) => {
      try {
        await fsAccess(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function createVirtualWorkspace(cwd: string): Workspace {
  const state = new Map<string, string | null>();

  async function ensureLoaded(absolutePath: string): Promise<void> {
    if (state.has(absolutePath)) {
      return;
    }

    try {
      const content = await fsReadFile(absolutePath, "utf-8");
      state.set(absolutePath, content);
    } catch {
      state.set(absolutePath, null);
    }
  }

  return {
    readText: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      const content = state.get(absolutePath);
      if (content === null || content === undefined) {
        throw new Error(`File not found: ${absolutePath.replace(`${cwd}/`, "")}`);
      }
      return content;
    },
    writeText: async (absolutePath: string, content: string) => {
      state.set(absolutePath, content);
    },
    deleteFile: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      if (state.get(absolutePath) === null) {
        throw new Error(`File not found: ${absolutePath.replace(`${cwd}/`, "")}`);
      }
      state.set(absolutePath, null);
    },
    renameFile: async (fromPath: string, toPath: string) => {
      await ensureLoaded(fromPath);
      const content = state.get(fromPath);
      if (content === null || content === undefined) {
        throw new Error(`File not found: ${fromPath.replace(`${cwd}/`, "")}`);
      }
      state.set(toPath, content);
      state.set(fromPath, null);
    },
    exists: async (absolutePath: string) => {
      await ensureLoaded(absolutePath);
      return state.get(absolutePath) !== null;
    },
  };
}

export async function withWorkspaceLocks<T>(
  absolutePaths: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  let run: () => Promise<T> = fn;

  for (let index = absolutePaths.length - 1; index >= 0; index -= 1) {
    const absolutePath = absolutePaths[index];
    if (absolutePath === undefined) {
      continue;
    }

    const nextRun = run;
    run = async (): Promise<T> => withFileMutationQueue(absolutePath, nextRun);
  }

  return run();
}
