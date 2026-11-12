import { app, BrowserWindow, shell } from "electron";

export interface DesktopOptions {
  url: string;
  userData?: string;
}

/** Thin, sandboxed client: the launcher-owned backend holds all execution. */
export async function startDesktop({ url, userData }: DesktopOptions): Promise<void> {
  const target = new URL(url);
  const token = new URLSearchParams(target.hash.slice(1)).get("token");
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    !token ||
    !/^[a-f0-9]{64}$/u.test(token)
  ) {
    throw new Error("Use the loopback connection URL printed by the Pagoda backend.");
  }
  if (userData) app.setPath("userData", userData);
  const quit = (): void => {
    app.quit();
  };
  app.on("window-all-closed", quit);
  process.once("SIGTERM", quit);
  process.once("SIGINT", quit);
  process.once("disconnect", quit);
  await app.whenReady();
  const window = new BrowserWindow({
    title: "Pagoda",
    width: 1100,
    height: 800,
    minWidth: 560,
    minHeight: 420,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url: externalUrl }) => {
    try {
      const external = new URL(externalUrl);
      if (
        (external.protocol === "https:" || external.protocol === "http:") &&
        !external.username &&
        !external.password
      )
        void shell.openExternal(external.href).catch((error: unknown) => {
          console.error("Could not open external link:", error);
        });
    } catch {
      // Reject invalid URLs.
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  await window.loadURL(target.href);
}
