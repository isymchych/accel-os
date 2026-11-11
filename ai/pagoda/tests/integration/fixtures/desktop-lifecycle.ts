import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import path from "node:path";
import { mock } from "node:test";

import type { SessionSnapshot } from "../../../src/desktop-api.ts";

// Exercise the real main/session/RPC code without starting Electron or a display.
const app = Object.assign(new EventEmitter(), {
  whenReady: async () => {
    await Promise.resolve();
  },
  setPath: () => {},
  quit: (): void => {
    const event = {
      defaultPrevented: false,
      preventDefault: (): void => {
        event.defaultPrevented = true;
      },
    };
    app.emit("before-quit", event);
    if (!event.defaultPrevented) app.emit("quit");
  },
});
const ready = new EventEmitter();
const windows: FakeWindow[] = [];
let updates = 0;
let closed = false;

class FakeWindow extends EventEmitter {
  private destroyed = false;
  private readonly contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => this.destroyed,
    send: (_channel: string, snapshot: SessionSnapshot): void => {
      assert.equal(closed, false, "No snapshot should be sent after window closure");
      updates += 1;
      if (snapshot.connection === "connected") ready.emit("connected");
    },
    setWindowOpenHandler: () => {},
    session: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
    },
  });

  public constructor() {
    super();
    windows.push(this);
  }

  public get webContents(): typeof this.contents {
    // The getter itself fails after destruction, before a webContents guard can run.
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return this.contents;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public async loadURL(): Promise<void> {
    await Promise.resolve();
  }

  public close(): void {
    closed = true;
    this.destroyed = true;
    this.emit("closed");
    app.emit("window-all-closed");
  }
}

mock.module("electron", {
  exports: {
    app,
    BrowserWindow: FakeWindow,
    dialog: {},
    ipcMain: { handle: () => {} },
  },
});

const connected = once(ready, "connected");
const { startDesktop } = await import("../../../src/electron/main.ts");
const directory = process.argv[2];
assert.ok(directory);
await startDesktop({
  pi: {
    executable: process.execPath,
    args: [path.join(import.meta.dirname, "fake-pi.ts")],
    cwd: directory,
    env: { ...process.env },
  },
  userData: path.join(directory, "electron"),
});
await connected;
const window = windows.at(0);
assert.ok(window !== undefined);
assert.ok(updates > 0, "The live renderer receives session snapshots");
const quit = once(app, "quit");
window.close();
await quit;
