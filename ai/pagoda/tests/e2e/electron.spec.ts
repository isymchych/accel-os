import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { _electron, expect, type ElectronApplication } from "@playwright/test";

import { test } from "./fixtures/backend.ts";

test("sandboxed Electron attaches to the shared backend and quitting leaves work running", async ({
  page: browserPage,
  testBackend: { backend, directory },
}) => {
  const source = path.resolve(import.meta.dirname, "../..");
  const lifecycle = { closed: false };
  let application: ElectronApplication | undefined;
  try {
    const executablePath: unknown = createRequire(import.meta.url)("electron");
    assert.ok(typeof executablePath === "string");
    const env: Record<string, string> = { HOME: directory };
    for (const name of ["PATH", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "LANG"]) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    application = await _electron.launch({
      executablePath,
      args: [
        ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
        path.join(source, "tests/e2e/fixtures/main.mjs"),
        backend.connectionUrl,
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
    expect(await page.evaluate(() => "require" in globalThis || "process" in globalThis)).toBe(
      false,
    );
    expect(await page.evaluate(() => "pi" in globalThis.window)).toBe(false);
    expect(new URL(page.url()).hash).toBe("");
    await page.getByLabel("Message", { exact: true }).fill("hold");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
    const pid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
    await browserPage.goto(backend.connectionUrl);
    await expect(browserPage.getByRole("status").first()).toContainText("running");
    await application.close();
    process.kill(pid, 0);
    await browserPage.reload();
    await expect(browserPage.getByRole("status").first()).toContainText("running");
    await backend.close();
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    if (application && !lifecycle.closed) await application.close();
  }
});
