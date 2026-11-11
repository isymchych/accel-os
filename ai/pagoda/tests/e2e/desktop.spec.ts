import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
        "XAUTHORITY",
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
        args: [
          ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
          path.join(source, "tests/e2e/fixtures/main.mjs"),
          process.execPath,
          directory,
        ],
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

test("the preset follows system appearance and uses system fonts", async ({
  desktop: { page },
}) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const body = page.locator("body");
  await expect(body).toHaveCSS("background-color", "oklch(1 0 0)");
  await expect(body).toHaveCSS("font-family", /^ui-sans-serif, system-ui,/u);
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("Keep this draft while appearance changes");
  expect(
    await message.evaluate((element) =>
      Number.parseFloat(globalThis.window.getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.00001);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(body).toHaveCSS("background-color", "oklch(0.141 0.005 285.823)");
  await expect(message).toHaveValue("Keep this draft while appearance changes");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

test("rejected input preserves the draft across renderer reload", async ({ desktop: { page } }) => {
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("reject");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("region", { name: "Direct agent" }).getByRole("alert")).toContainText(
    "Rejected test prompt",
  );
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
  await expect(page.getByRole("region", { name: "Direct agent" }).getByRole("alert")).toContainText(
    "Pi exited",
  );
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
  const stale = await page.evaluate(async () => {
    const { initialKey } = await globalThis.window.pi.workspace();
    return globalThis.window.pi.snapshot(initialKey);
  });
  await application.evaluate(({ ipcMain }, snapshot) => {
    let requested = false;
    const released = new Promise<void>((resolve) => {
      ipcMain.once("test:release-snapshot", () => {
        resolve();
      });
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
  await page.evaluate(
    async (key) => globalThis.window.pi.prompt({ key, mode: "prompt", message: "hold" }),
    stale.key,
  );
  await expect(page.getByRole("status").first()).toContainText("running");
  await application.evaluate(({ ipcMain }) => {
    ipcMain.emit("test:release-snapshot");
  });
  await page.evaluate(async (key) => {
    await globalThis.window.pi.snapshot(key);
    // Let React render after the delayed IPC response, rather than asserting before delivery.
    await new Promise<void>((resolve) => {
      globalThis.window.requestAnimationFrame(() => {
        globalThis.window.requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }, stale.key);
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

test("directory selection, independent drafts, and a pending Stop stay bound to their sessions", async ({
  desktop: { application, page, directory },
}) => {
  const other = path.join(directory, "other-project");
  await mkdir(other);
  const initialKey = await page.evaluate(
    async () => (await globalThis.window.pi.workspace()).initialKey,
  );
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
  await message.fill("A draft");
  await application.evaluate(({ dialog }, cwd) => {
    dialog.showOpenDialog = async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: false,
      filePaths: [cwd],
    });
  }, other);
  await page.getByRole("button", { name: "Choose directory", exact: true }).click();
  await expect(page.getByRole("complementary")).toContainText(other);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const sessions = page.getByRole("navigation", { name: "Open sessions" }).getByRole("button");
  await expect(sessions).toHaveCount(2);
  await expect(page.getByRole("status").first()).toContainText("idle");
  await message.fill("B draft");
  await sessions.nth(0).click();
  await expect(message).toHaveValue("A draft");
  await writeFile(path.join(directory, "delay-abort"), "delay");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect
    .poll(async () => readFile(path.join(directory, "abort-pending"), "utf8").catch(() => ""))
    .toBe("pending");
  await expect(page.getByRole("status").first()).toContainText("stopping");
  await sessions.nth(1).click();
  await expect(message).toHaveValue("B draft");
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  await writeFile(path.join(directory, "release-abort"), "release");
  await expect
    .poll(async () =>
      page.evaluate(
        async (key) => (await globalThis.window.pi.snapshot(key)).execution,
        initialKey,
      ),
    )
    .toBe("idle");
  await expect(page.getByRole("status").first()).toContainText("running");
  await message.fill("B retained draft");
  await page.reload();
  await expect(message).toHaveValue("B retained draft");
  await expect(page.getByRole("status").first()).toContainText("running");
});

test("history forks preserve active source work and reopening reuses its owner", async ({
  desktop: { page },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  const initialKey = await page.evaluate(
    async () => (await globalThis.window.pi.workspace()).initialKey,
  );
  await message.fill("original history");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
  const saved = page.getByRole("region", { name: "Saved sessions" });
  await expect(saved.getByRole("button")).toHaveCount(1);
  await saved.getByRole("button").click();
  const sessions = page.getByRole("navigation", { name: "Open sessions" }).getByRole("button");
  await expect(sessions).toHaveCount(1);
  await page.getByRole("button", { name: "History and branches", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "History entry", exact: true })).toContainText(
    "assistant:",
  );
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  await page.getByRole("button", { name: "Fork session", exact: true }).click();
  await expect(sessions).toHaveCount(2);
  await expect(page.getByRole("article", { name: "user message" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "user message" })).toContainText(
    "original history",
  );
  expect(
    await page.evaluate(
      async (key) => (await globalThis.window.pi.snapshot(key)).execution,
      initialKey,
    ),
  ).toBe("running");
  await page.getByRole("button", { name: "History and branches", exact: true }).click();
  await page.getByRole("combobox", { name: "History entry", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "user: original history" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toHaveCount(0);
  await expect(message).toHaveValue("original history");
  await page.reload();
  await expect(message).toHaveValue("original history");
  await page.getByRole("button", { name: "History and branches", exact: true }).click();
  await page.getByRole("combobox", { name: "History entry", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "assistant: Hello" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await expect(message).toHaveValue("original history");
});

test("shadcn model/thinking controls and distinct follow-up/steering reach Pi", async ({
  desktop: { page, directory },
}) => {
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "fake/Other", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toContainText(
    "fake/other",
  );
  await page.getByRole("combobox", { name: "Thinking", exact: true }).click();
  await page.getByRole("option", { name: "high", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Thinking", exact: true })).toContainText("high");
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  await page.getByRole("button", { name: "harmless-wait · running", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tool activity" })).toContainText(
    "Waiting for cancellation",
  );
  await message.fill("explicit follow-up");
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  await expect(message).toHaveValue("");
  await message.fill("explicit steering");
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await expect(message).toHaveValue("");
  const queued = (await readFile(path.join(directory, "queue.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(queued).toEqual([
    expect.objectContaining({ type: "follow_up", message: "explicit follow-up" }),
    expect.objectContaining({ type: "steer", message: "explicit steering" }),
  ]);
});

test("idle follow-up and steering execute immediately", async ({ desktop: { page } }) => {
  const message = page.getByLabel("Message", { exact: true });
  for (const [index, action] of ["Follow up", "Steer"].entries()) {
    await message.fill(`Idle ${action}`);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(message).toHaveValue("");
    await expect(page.getByRole("article", { name: "assistant message" })).toHaveCount(index + 1);
    await expect(page.getByRole("status").first()).toContainText("idle");
  }
});

test("a delayed Send acknowledgement clears only its original session's draft", async ({
  desktop: { page, directory },
}) => {
  await writeFile(path.join(directory, "delay-prompt"), "delay");
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("delayed");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => readFile(path.join(directory, "prompt-pending"), "utf8").catch(() => ""))
    .toBe("pending");
  await expect(message).toHaveValue("delayed");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const sessions = page.getByRole("navigation", { name: "Open sessions" }).getByRole("button");
  await expect(sessions).toHaveCount(2);
  await expect(page.getByRole("status").first()).toContainText("idle");
  await message.fill("B must keep this draft");
  await writeFile(path.join(directory, "release-prompt"), "release");
  await sessions.nth(0).click();
  await expect(message).toHaveValue("");
  await sessions.nth(1).click();
  await expect(message).toHaveValue("B must keep this draft");
});

test("rejected model changes and navigation keep confirmed controls and transcript", async ({
  desktop: { application, page },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("preserved history");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const assistant = page.getByRole("article", { name: "assistant message" });
  await expect(assistant).toContainText("Hello from fake Pi.");
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("fake/fixture");
  // Inject rejection at the main/preload boundary; Node tests cover Pi rejection.
  await application.evaluate(({ ipcMain }) => {
    for (const channel of ["pi:model", "pi:navigate"]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        throw new Error(`Rejected ${channel} for test`);
      });
    }
  });
  await model.click();
  await page.getByRole("option", { name: "fake/Other", exact: true }).click();
  const controls = page.getByRole("region", { name: "Session controls" });
  await expect(controls.getByRole("alert")).toContainText("Rejected pi:model");
  await expect(model).toContainText("fake/fixture");
  await expect(model).toBeEnabled();
  await page.getByRole("button", { name: "History and branches", exact: true }).click();
  await page.getByRole("combobox", { name: "History entry", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "user: preserved history" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(controls.getByRole("alert")).toContainText("Rejected pi:navigate");
  await expect(assistant).toContainText("Hello from fake Pi.");
  await expect(page.getByRole("article", { name: "user message" })).toContainText(
    "preserved history",
  );
  await expect(page.getByRole("button", { name: "Navigate", exact: true })).toBeEnabled();
  await page.reload();
  await expect(model).toContainText("fake/fixture");
  await expect(assistant).toContainText("Hello from fake Pi.");
});

test("long transcript content remains available through the shadcn disclosure", async ({
  desktop: { page },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("long-output");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const output = page.getByRole("article", { name: "assistant message" });
  await expect(output).toContainText("Large output");
  await expect(output.getByText(/END_OF_LONG_OUTPUT/u)).toHaveCount(0);
  await output.getByRole("button", { name: /Show full content/u }).click();
  await expect(output).toContainText("END_OF_LONG_OUTPUT");
});

test("keyboard navigation scrolls and focuses the composer without intercepting typing", async ({
  desktop: { page },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  await page.keyboard.press("i");
  await expect(message).toBeFocused();
  await page.keyboard.type("jkggG[]?i");
  await expect(message).toHaveValue("jkggG[]?i");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await message.fill("long-output");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const output = page.getByRole("article", { name: "assistant message" });
  await output.getByRole("button", { name: /Show full content/u }).click();
  await message.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect.poll(async () => page.evaluate(() => globalThis.window.scrollY)).toBe(0);
  await page.keyboard.press("j");
  await expect.poll(async () => page.evaluate(() => globalThis.window.scrollY)).toBeGreaterThan(0);
  await page.keyboard.press("k");
  await expect.poll(async () => page.evaluate(() => globalThis.window.scrollY)).toBe(0);
  await page.keyboard.press("Control+d");
  const halfPage = await page.evaluate(() => globalThis.window.innerHeight / 2);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => globalThis.window.scrollY)) - halfPage))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("Control+u");
  await expect
    .poll(async () => page.evaluate(() => globalThis.window.scrollY))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("Shift+g");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          globalThis.document.documentElement.scrollHeight -
          globalThis.window.innerHeight -
          globalThis.window.scrollY,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("i");
  await expect(message).toBeFocused();
  await message.fill("Do not submit or erase this draft");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+u");
  await expect(message).toBeFocused();
  await expect(message).toHaveValue("Do not submit or erase this draft");
  await expect(page.getByRole("article", { name: "user message" })).toHaveCount(1);
});

test("keyboard session switching preserves drafts and work while overlays own their keys", async ({
  desktop: { page },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  const initialKey = await page.evaluate(
    async () => (await globalThis.window.pi.workspace()).initialKey,
  );
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  await message.fill("A draft");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").first()).toContainText("running");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const sessions = page.getByRole("navigation", { name: "Open sessions" }).getByRole("button");
  await expect(sessions).toHaveCount(2);
  await message.fill("B draft");
  await page.keyboard.press("Escape");
  await page.keyboard.press("[");
  await expect(message).toHaveValue("A draft");
  await expect(page.getByRole("status").first()).toContainText("running");
  await page.keyboard.press("[");
  await expect(message).toHaveValue("A draft");
  await page.keyboard.press("]");
  await expect(message).toHaveValue("B draft");
  await page.keyboard.press("]");
  await expect(message).toHaveValue("B draft");

  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("[");
  await page.keyboard.press("i");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(message).not.toBeFocused();
  await expect(message).toHaveValue("B draft");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("main").focus();
  await page.keyboard.press("Shift+/");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  const scrollBefore = await page.evaluate(() => globalThis.window.scrollY);
  await page.keyboard.press("[");
  await page.keyboard.press("j");
  await page.keyboard.press("i");
  await expect(help).toBeVisible();
  await expect(message).not.toBeFocused();
  expect(await page.evaluate(() => globalThis.window.scrollY)).toBe(scrollBefore);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(message).toHaveValue("B draft");
  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page.evaluate(
      async (key) => (await globalThis.window.pi.snapshot(key)).execution,
      initialKey,
    ),
  ).toBe("running");
});
