import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

type Sender = { sender: object; senderFrame: { url: string } | null };
type Handler = (event: Sender, request?: unknown) => unknown;
const handlers = new Map<string, Handler>();
const prompts: string[] = [];
let stops = 0;
let snapshots = 0;
const windows: FakeWindow[] = [];
const app = Object.assign(new EventEmitter(), {
  whenReady: async () => {},
  quit: () => {},
});

class FakeWindow extends EventEmitter {
  public readonly webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: "" },
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

  public async loadURL(url: string): Promise<void> {
    this.webContents.mainFrame.url = url;
  }
}

mock.module("electron", {
  exports: {
    app,
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  },
});
mock.module(path.resolve(import.meta.dirname, "../../src/electron/session.ts"), {
  exports: {
    DesktopSession: class {
      public subscribe(): () => void {
        return () => {};
      }
      public async start(): Promise<void> {}
      public snapshot(): object {
        snapshots += 1;
        return { connection: "connected" };
      }
      public async prompt(message: string): Promise<void> {
        prompts.push(message);
      }
      public async stop(): Promise<void> {
        stops += 1;
      }
    },
  },
});
const { startDesktop } = await import("../../src/electron/main.ts");

async function invoke(channel: string, sender: Sender, request?: unknown): Promise<unknown> {
  const handler = handlers.get(channel);
  assert.ok(handler, `Missing IPC handler: ${channel}`);
  return handler(sender, request);
}

test("IPC authorizes the exact main frame and validates prompts before calling Pi", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-ipc-"));
  const signals = ["SIGTERM", "SIGINT"] as const;
  const originalListeners = signals.map((signal) => new Set(process.listeners(signal)));
  t.after(async () => {
    for (const [index, signal] of signals.entries()) {
      for (const listener of process.listeners(signal)) {
        if (!originalListeners[index]?.has(listener)) process.removeListener(signal, listener);
      }
    }
    app.removeAllListeners();
    await rm(directory, { recursive: true, force: true });
  });
  await startDesktop({
    pi: { executable: "/unused/node", args: [], cwd: directory, env: {} },
  });
  const window = windows.at(-1);
  assert.ok(window);
  const trusted = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  assert.deepEqual(await invoke("pi:snapshot", trusted), { connection: "connected" });
  assert.equal(snapshots, 1);

  for (const [name, sender] of [
    ["another window", { ...trusted, sender: {} }],
    ["another frame at the same URL", { ...trusted, senderFrame: { ...trusted.senderFrame } }],
    ["a missing frame", { ...trusted, senderFrame: null }],
  ] as const) {
    await t.test(`rejects ${name} on every channel`, async () => {
      for (const channel of ["pi:snapshot", "pi:prompt", "pi:stop"]) {
        await assert.rejects(
          invoke(channel, sender, { message: "must not execute" }),
          /Untrusted desktop IPC sender/,
        );
      }
    });
  }

  await t.test("rejects the original frame after its URL changes", async () => {
    const url = trusted.senderFrame.url;
    trusted.senderFrame.url = `${url}?untrusted`;
    try {
      for (const channel of ["pi:snapshot", "pi:prompt", "pi:stop"]) {
        await assert.rejects(
          invoke(channel, trusted, { message: "must not execute" }),
          /Untrusted desktop IPC sender/,
        );
      }
    } finally {
      trusted.senderFrame.url = url;
    }
  });

  await t.test("rejects malformed, empty, and oversized prompts", async () => {
    for (const request of [
      null,
      {},
      { message: 42 },
      { message: "" },
      { message: " \n\t " },
      { message: "x".repeat(100_001) },
      { message: "execute", extra: "not allowed" },
    ]) {
      await assert.rejects(
        invoke("pi:prompt", trusted, request),
        /Enter a message of at most 100,000 characters/,
      );
    }
    assert.deepEqual(prompts, []);
    assert.equal(stops, 0);
    assert.equal(snapshots, 1, "Rejected senders cannot read session state either");
  });

  await t.test("forwards valid boundary-sized input and Stop from the trusted frame", async () => {
    const message = "x".repeat(100_000);
    await invoke("pi:prompt", trusted, { message });
    await invoke("pi:stop", trusted);
    assert.deepEqual(prompts, [message]);
    assert.equal(stops, 1);
  });
});
