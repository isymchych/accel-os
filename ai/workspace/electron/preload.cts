import type { DesktopApi, SessionSnapshot } from "../contracts/desktop.ts";

// Electron's sandboxed preload is CommonJS and may only require supported built-ins.
// oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-var-requires, typescript/no-require-imports -- Sandboxed preload requires Electron's native CommonJS module.
const { contextBridge, ipcRenderer }: typeof import("electron") = require("electron");

const api: DesktopApi = {
  snapshot: async () =>
    ipcRenderer.invoke("pi:snapshot").then((snapshot: SessionSnapshot) => snapshot),
  prompt: async (request) => {
    await ipcRenderer.invoke("pi:prompt", request);
  },
  stop: async () => {
    await ipcRenderer.invoke("pi:stop");
  },
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
