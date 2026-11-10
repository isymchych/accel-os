import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  _electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import type { DesktopApi } from "../../src/desktop-api.ts";

interface Desktop {
  application: ElectronApplication;
  page: Page;
  directory: string;
}
declare global {
  interface Window {
    pi: DesktopApi;
  }
}

const test = base.extend<{ desktop: Desktop }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  desktop: async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), "pi-electron-"));
    let application: ElectronApplication | undefined;
    const lifecycle = { closed: false };
    try {
      const source = path.resolve(import.meta.dirname, "../..");
      const executablePath: unknown = createRequire(import.meta.url)("electron");
      if (typeof executablePath !== "string") throw new Error("Electron binary unavailable");
      const env: Record<string, string> = {};
      for (const name of [
        "PATH",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "DBUS_SESSION_BUS_ADDRESS",
        "LANG",
      ]) {
        const value = process.env[name];
        if (value !== undefined) env[name] = value;
      }
      Object.assign(env, { HOME: directory, FAKE_PI_STATE: directory });
      application = await _electron.launch({
        executablePath,
        args: [path.join(source, "tests/e2e/fixtures/main.mjs"), process.execPath, directory],
        env,
        chromiumSandbox: true,
      });
      application.on("close", () => {
        lifecycle.closed = true;
      });
      const page = await application.firstWindow();
      await expect(page.getByRole("status").first()).toContainText("connected");
      await use({ application, page, directory });
    } finally {
      try {
        if (application && !lifecycle.closed) await application.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
});

test("sandboxed renderer submits text without interpreting agent output as HTML", async ({
  desktop: { page },
}) => {
  expect(await page.evaluate(() => "require" in globalThis)).toBe(false);
  expect(await page.evaluate(() => "process" in globalThis)).toBe(false);
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toContainText(
    "Hello from fake Pi.",
  );
  await expect(message).toHaveValue("");
  await expect(page.getByRole("article", { name: "user message" })).toContainText("<img src=x");
  await expect(page.locator("img")).toHaveCount(0);
});

test("rejected input preserves the draft across renderer reload", async ({ desktop: { page } }) => {
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("reject");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Rejected test prompt");
  await expect(message).toHaveValue("reject");
  await page.reload();
  await expect(message).toHaveValue("reject");
});

test("accepted input with a lost acknowledgement preserves its draft without replay", async ({
  desktop: { page, directory },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("uncertain");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Pi exited");
  await expect(message).toHaveValue("uncertain");
  await expect(page.getByRole("status").first()).toContainText("unknown");
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText("disconnected");
  await expect(message).toHaveValue("uncertain");
  const prompts = (await readFile(path.join(directory, "prompts.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(prompts).toEqual([{ message: "uncertain" }]);
});

test("renderer reload reattaches to active work and Stop terminates the tool", async ({
  desktop: { page, directory },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  process.kill(toolPid, 0);
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText("running");
  await expect(page.getByRole("article", { name: "user message" })).toContainText("hold");
  await expect(page.getByRole("article", { name: "Streaming response" })).toContainText("Working");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("idle");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});

test("a delayed initial snapshot cannot overwrite newer streaming state", async ({
  desktop: { application, page },
}) => {
  const stale = await page.evaluate(async () => globalThis.window.pi.snapshot());
  await application.evaluate(({ ipcMain }, snapshot) => {
    let requested = false;
    const released = new Promise<void>((resolve) => {
      ipcMain.once("test:release-snapshot", () => resolve());
    });
    ipcMain.on("test:await-snapshot", (_event, resolve: () => void) => {
      if (requested) resolve();
      else ipcMain.once("test:snapshot-requested", resolve);
    });
    ipcMain.removeHandler("pi:snapshot");
    ipcMain.handle("pi:snapshot", async () => {
      requested = true;
      ipcMain.emit("test:snapshot-requested");
      await released;
      return snapshot;
    });
  }, stale);
  await page.reload();
  await application.evaluate(
    async ({ ipcMain }) =>
      new Promise<void>((resolve) => {
        ipcMain.emit("test:await-snapshot", null, resolve);
      }),
  );
  await page.evaluate(async () => globalThis.window.pi.prompt({ message: "hold" }));
  await expect(page.getByRole("status").first()).toContainText("running");
  await application.evaluate(({ ipcMain }) => {
    ipcMain.emit("test:release-snapshot");
  });
  await page.evaluate(async () => {
    await globalThis.window.pi.snapshot();
    // Let React render after the delayed IPC response, rather than asserting before delivery.
    await new Promise<void>((resolve) => {
      globalThis.window.requestAnimationFrame(() =>
        globalThis.window.requestAnimationFrame(() => resolve()),
      );
    });
  });
  await expect(page.getByRole("status").first()).toContainText("running");
  await expect(page.getByRole("article", { name: "Streaming response" })).toContainText("Working");
});

test("quitting the desktop closes Pi and terminates active tool work", async ({
  desktop: { application, page, directory },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  process.kill(toolPid, 0);
  await application.close();
  expect(await readFile(path.join(directory, "closed"), "utf8")).toBe("clean");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});
