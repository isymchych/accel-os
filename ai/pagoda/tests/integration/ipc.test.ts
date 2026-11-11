import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

type Sender = { sender: object; senderFrame: { url: string } | null };
type Handler = (event: Sender, request?: unknown) => unknown;
const handlers = new Map<string, Handler>();
const calls: unknown[] = [];
const windows: FakeWindow[] = [];
const app = Object.assign(new EventEmitter(), { whenReady: async () => {}, quit: () => {} });
class FakeWindow extends EventEmitter {
  public readonly webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: "" },
    setWindowOpenHandler: () => {},
    session: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} },
  });
  public constructor() {
    super();
    windows.push(this);
  }
  public async loadURL(url: string): Promise<void> {
    this.webContents.mainFrame.url = url;
  }
}
mock.module("electron", {
  exports: {
    app,
    BrowserWindow: FakeWindow,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  },
});
mock.module(path.resolve(import.meta.dirname, "../../src/electron/workspace.ts"), {
  exports: {
    DesktopWorkspace: class {
      public subscribe(): () => void {
        return () => {};
      }
      public async start(): Promise<void> {}
      public snapshot(): object {
        calls.push("workspace");
        return {};
      }
      public session(key: string): {
        snapshot: () => object;
        prompt: (message: string, mode: string) => Promise<void>;
        stop: () => Promise<void>;
      } {
        calls.push({ key });
        return {
          snapshot: (): object => {
            calls.push("snapshot");
            return {};
          },
          prompt: async (message: string, mode: string): Promise<void> => {
            calls.push({ message, mode });
          },
          stop: async (): Promise<void> => {
            calls.push("stop");
          },
        };
      }
    },
  },
});
const { startDesktop } = await import("../../src/electron/main.ts");
async function invoke(channel: string, sender: Sender, request?: unknown): Promise<unknown> {
  const handler = handlers.get(channel);
  assert.ok(handler);
  return await handler(sender, request);
}
test("every IPC method authorizes the exact main frame and validates explicit targets", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-ipc-"));
  const signals = ["SIGTERM", "SIGINT"] as const;
  const original = signals.map((signal) => new Set(process.listeners(signal)));
  t.after(async () => {
    for (const [index, signal] of signals.entries())
      for (const listener of process.listeners(signal)) {
        if (!original[index]?.has(listener)) process.removeListener(signal, listener);
      }
    app.removeAllListeners();
    await rm(directory, { recursive: true, force: true });
  });
  await startDesktop({ pi: { executable: "/unused/node", args: [], cwd: directory, env: {} } });
  const window = windows.at(-1);
  assert.ok(window);
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  for (const sender of [
    { ...trusted, sender: {} },
    { ...trusted, senderFrame: { ...trusted.senderFrame } },
    { ...trusted, senderFrame: null },
  ]) {
    for (const channel of handlers.keys()) {
      await assert.rejects(invoke(channel, sender), /Untrusted desktop IPC sender/u);
    }
  }
  const url = trusted.senderFrame.url;
  trusted.senderFrame.url = `${url}?untrusted`;
  for (const channel of handlers.keys())
    await assert.rejects(invoke(channel, trusted), /Untrusted desktop IPC sender/u);
  trusted.senderFrame.url = url;
  assert.deepEqual(calls, []);

  for (const channel of handlers.keys()) {
    if (["pi:workspace", "pi:directory"].includes(channel)) continue;
    for (const value of [null, {}, { key: "" }, { key: "A", extra: true }]) {
      await assert.rejects(invoke(channel, trusted, value), /Invalid pi:/u);
    }
  }
  for (const request of [
    { key: "A", mode: "prompt", message: "" },
    { key: "A", mode: "prompt", message: " \n " },
    { key: "A", mode: "prompt", message: "x".repeat(100_001) },
    { key: "A", message: "missing mode" },
  ])
    await assert.rejects(invoke("pi:prompt", trusted, request), /Invalid pi:|Enter a message/u);
  assert.deepEqual(calls, []);
  const message = "x".repeat(100_000);
  await invoke("pi:prompt", trusted, { key: "A", mode: "follow_up", message });
  await invoke("pi:stop", trusted, { key: "B" });
  assert.deepEqual(calls, [{ key: "A" }, { message, mode: "follow_up" }, { key: "B" }, "stop"]);
});
