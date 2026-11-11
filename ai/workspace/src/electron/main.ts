import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { TSchema, Static } from "typebox";
import { Value } from "typebox/value";

import {
  DirectorySchema,
  EntrySchema,
  ModelSchema,
  OpenSchema,
  PromptSchema,
  TargetSchema,
  ThinkingSchema,
} from "../desktop-api.ts";
import type { PiLaunch } from "./rpc.ts";
import { DesktopWorkspace } from "./workspace.ts";

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
  const workspace = new DesktopWorkspace({
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

  function handle<T extends TSchema>(
    channel: string,
    schema: T,
    action: (request: Static<T>) => unknown,
  ): void {
    ipcMain.handle(channel, (event, request: unknown) => {
      validateSender(event);
      if (!Value.Check(schema, request)) throw new Error(`Invalid ${channel} request`);
      return action(request);
    });
  }
  ipcMain.handle("pi:workspace", (event) => {
    validateSender(event);
    return workspace.snapshot();
  });
  ipcMain.handle("pi:directory", async (event) => {
    validateSender(event);
    if (!window) throw new Error("The desktop window is unavailable");
    const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle("pi:snapshot", TargetSchema, ({ key }) => workspace.session(key).snapshot());
  handle("pi:list", DirectorySchema, async ({ cwd: directory }) => workspace.list(directory));
  handle("pi:create", DirectorySchema, async ({ cwd: directory }) => workspace.create(directory));
  handle("pi:open", OpenSchema, async (request) => workspace.open(request.cwd, request.path));
  handle("pi:prompt", PromptSchema, async (request) => {
    if (request.message.trim().length === 0)
      throw new Error("Enter a message of at most 100,000 characters.");
    return workspace.session(request.key).prompt(request.message, request.mode);
  });
  handle("pi:stop", TargetSchema, async ({ key }) => workspace.session(key).stop());
  handle("pi:history", TargetSchema, async ({ key }) => workspace.session(key).history());
  handle("pi:navigate", EntrySchema, async ({ key, entryId }) =>
    workspace.session(key).navigate(entryId),
  );
  handle("pi:fork", EntrySchema, async ({ key, entryId }) => workspace.fork(key, entryId));
  handle("pi:controls", TargetSchema, async ({ key }) => workspace.session(key).controls());
  handle("pi:model", ModelSchema, async ({ key, provider, modelId }) =>
    workspace.session(key).model(provider, modelId),
  );
  handle("pi:thinking", ThinkingSchema, async ({ key, level }) =>
    workspace.session(key).thinking(level),
  );

  const unsubscribe = workspace.subscribe((snapshot) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("pi:changed", snapshot);
    }
  });

  app.on("before-quit", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void workspace
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
  void workspace.start().catch((error: unknown) => {
    console.error("Pi startup failed:", error);
  });
}
