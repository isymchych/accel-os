import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron, expect, test } from "@playwright/test";

test("sandboxed desktop submits, reconnects, stops, and shuts down isolated Pi work", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-electron-"));
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
  Object.assign(env, {
    HOME: directory,
    FAKE_PI_STATE: directory,
  });
  const application = await _electron.launch({
    executablePath,
    args: [path.join(source, "tests/e2e/fixtures/main.mjs"), process.execPath, directory],
    env,
    chromiumSandbox: true,
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("status").first()).toContainText("connected");
    expect(await page.evaluate(() => "require" in globalThis)).toBe(false);
    expect(await page.evaluate(() => "process" in globalThis)).toBe(false);

    const message = page.getByLabel("Message", { exact: true });
    await message.fill("<img src=x onerror=alert(1)>");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("article", { name: "assistant message" })).toContainText(
      "Hello from fake Pi.",
    );
    await expect(page.getByRole("article", { name: "user message" })).toContainText("<img src=x");
    await expect(page.locator("img")).toHaveCount(0);

    await message.fill("reject");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Rejected test prompt");
    await expect(message).toHaveValue("reject");
    await page.reload();
    await expect(message).toHaveValue("reject");
    await expect(page.getByRole("article", { name: "assistant message" })).toContainText(
      "Hello from fake Pi.",
    );

    await message.fill("hold");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
    const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText("running");
    await expect(page.getByRole("article", { name: "Streaming response" })).toContainText(
      "Working",
    );
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status").first()).toContainText("idle");
    expect(() => process.kill(toolPid, 0)).toThrow();

    await message.fill("hold");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
  } finally {
    await application.close();
    try {
      expect(await readFile(path.join(directory, "closed"), "utf8")).toBe("clean");
      const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
      expect(() => process.kill(toolPid, 0)).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
