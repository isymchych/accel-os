import type { DesktopApi, SessionSnapshot } from "../desktop-api.ts";

// Electron's sandboxed preload is CommonJS and may only require supported built-ins.
// oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-var-requires, typescript/no-require-imports -- Sandboxed preload requires Electron's native CommonJS module.
const { contextBridge, ipcRenderer }: typeof import("electron") = require("electron");

async function invoke<T>(channel: string, request?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, request).then((value: T) => value);
}
const api: DesktopApi = {
  workspace: async () => invoke("pi:workspace"),
  chooseDirectory: async () => invoke("pi:directory"),
  list: async (cwd) => invoke("pi:list", { cwd }),
  create: async (cwd) => invoke("pi:create", { cwd }),
  open: async (cwd, path) => invoke("pi:open", { cwd, path }),
  snapshot: async (key) => invoke("pi:snapshot", { key }),
  prompt: async (request) => invoke("pi:prompt", request),
  stop: async (key) => invoke("pi:stop", { key }),
  history: async (key) => invoke("pi:history", { key }),
  navigate: async (key, entryId) => invoke("pi:navigate", { key, entryId }),
  fork: async (key, entryId) => invoke("pi:fork", { key, entryId }),
  controls: async (key) => invoke("pi:controls", { key }),
  model: async (key, provider, modelId) => invoke("pi:model", { key, provider, modelId }),
  thinking: async (key, level) => invoke("pi:thinking", { key, level }),
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: SessionSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on("pi:changed", receive);
    return () => {
      ipcRenderer.removeListener("pi:changed", receive);
    };
  },
};
contextBridge.exposeInMainWorld("pi", api);
