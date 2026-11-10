import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { Value } from "typebox/value";

import { PromptSchema } from "../desktop-api.ts";
import type { PiLaunch } from "./rpc.ts";
import { DesktopSession } from "./session.ts";

export interface DesktopOptions {
  pi: PiLaunch;
  developmentUrl?: string;
  userData?: string;
}

export async function startDesktop({
  pi,
  developmentUrl,
  userData,
}: DesktopOptions): Promise<void> {
  if (
    developmentUrl &&
    (new URL(developmentUrl).hostname !== "127.0.0.1" ||
      new URL(developmentUrl).protocol !== "http:")
  ) {
    throw new Error("The development renderer must use explicit IPv4 loopback.");
  }
  const rendererFile = path.resolve(import.meta.dirname, "../../client/index.html");
  const rendererUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
  const cwd = await realpath(pi.cwd);
  if (userData) app.setPath("userData", userData);
  const session = new DesktopSession({
    ...pi,
    cwd,
    env: { ...pi.env, AI_CWD: cwd },
  });
  let window: BrowserWindow | null = null;
  let quitAllowed = false;
  let quitting = false;

  function validateSender(event: IpcMainInvokeEvent): void {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl
    ) {
      throw new Error("Untrusted desktop IPC sender");
    }
  }

  ipcMain.handle("pi:snapshot", (event) => {
    validateSender(event);
    return session.snapshot();
  });
  ipcMain.handle("pi:prompt", async (event, request: unknown) => {
    validateSender(event);
    if (!Value.Check(PromptSchema, request) || request.message.trim().length === 0) {
      throw new Error("Enter a message of at most 100,000 characters.");
    }
    await session.prompt(request.message);
  });
  ipcMain.handle("pi:stop", async (event) => {
    validateSender(event);
    await session.stop();
  });

  const unsubscribe = session.subscribe((snapshot) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("pi:changed", snapshot);
    }
  });

  app.on("before-quit", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void session
      .close()
      .catch((error: unknown) => {
        console.error("Could not close Pi cleanly:", error);
      })
      .finally(() => {
        quitAllowed = true;
        app.quit();
      });
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  process.on("SIGTERM", () => {
    app.quit();
  });
  process.on("SIGINT", () => {
    app.quit();
  });

  await app.whenReady();
  window = new BrowserWindow({
    title: "Pi workspace",
    width: 1100,
    height: 800,
    minWidth: 560,
    minHeight: 420,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.once("closed", () => {
    window = null;
    unsubscribe();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
  await window.loadURL(rendererUrl);
  if (developmentUrl) window.webContents.openDevTools({ mode: "detach" });
  void session.start().catch((error: unknown) => {
    console.error("Pi startup failed:", error);
  });
}
