import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

import type { BrowserWindowConstructorOptions } from "electron";

const windows: FakeWindow[] = [];
const opened: string[] = [];
let openHandler: (details: { url: string }) => { action: string };
const app = Object.assign(new EventEmitter(), { whenReady: async () => {}, quit: () => {} });
class FakeWindow {
  public readonly options: BrowserWindowConstructorOptions;
  public url = "";
  public readonly webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => {
      openHandler = handler;
    },
    session: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: (handler: () => boolean) => {
        assert.equal(handler(), false);
      },
    },
  });
  public constructor(options: BrowserWindowConstructorOptions) {
    this.options = options;
    windows.push(this);
  }
  public async loadURL(url: string): Promise<void> {
    this.url = url;
  }
}
mock.module("electron", {
  exports: {
    app,
    BrowserWindow: FakeWindow,
    shell: {
      openExternal: async (url: string) => {
        opened.push(url);
      },
    },
  },
});
const { startDesktop } = await import("../../src/electron/main.ts");

test("the shell only accepts loopback connection URLs and retains Chromium security boundaries", async (t) => {
  const signals = ["SIGTERM", "SIGINT"] as const;
  const original = signals.map((signal) => new Set(process.listeners(signal)));
  t.after(() => {
    app.removeAllListeners();
    for (const [index, signal] of signals.entries())
      for (const listener of process.listeners(signal))
        if (!original[index]?.has(listener)) process.removeListener(signal, listener);
  });
  const token = "a".repeat(64);
  for (const url of [
    `https://127.0.0.1/#token=${token}`,
    `http://hostile.invalid/#token=${token}`,
    `http://localhost/#token=${token}`,
    `http://127.0.0.1/other#token=${token}`,
    `http://user:pass@127.0.0.1/#token=${token}`,
    "http://127.0.0.1/",
  ])
    await assert.rejects(startDesktop({ url }), /loopback connection URL/u);
  assert.equal(windows.length, 0);
  const url = `http://127.0.0.1:4317/#token=${token}`;
  await startDesktop({ url });
  const window = windows[0];
  assert.ok(window);
  assert.equal(window.url, url);
  assert.equal(openHandler({ url: "https://example.com/path" }).action, "deny");
  assert.equal(openHandler({ url: "file:///etc/passwd" }).action, "deny");
  assert.equal(openHandler({ url: "https://user:pass@example.com/" }).action, "deny");
  assert.deepEqual(opened, ["https://example.com/path"]);
  assert.deepEqual(window.options.webPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });
  for (const event of ["will-navigate", "will-attach-webview"]) {
    let prevented = false;
    window.webContents.emit(event, {
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
});
