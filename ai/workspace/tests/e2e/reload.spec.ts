import { expect, test } from "@playwright/test";
import { Value } from "typebox/value";

import { ReloadStatusSchema, type ReloadStatus } from "../../contracts/reload.ts";

test("Check & Reload runs the canonical workflow, refreshes, and preserves the draft", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  async function status(): Promise<ReloadStatus> {
    const response = await request.get("/api/reload");
    const value: unknown = await response.json();
    if (!Value.Check(ReloadStatusSchema, value)) throw new Error("Invalid reload status.");
    return value;
  }
  const before = await status();
  await page.goto("/a-saved-view");
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Keep this unsent message");
  const refreshed = page.waitForEvent("load", { timeout: 90_000 });
  await page.getByRole("button", { name: "Check & Reload" }).click();
  await refreshed;

  await expect(message).toHaveValue("Keep this unsent message");
  await expect(page).toHaveURL(/\/a-saved-view$/);
  await expect(page.getByLabel("Reload status")).toHaveText("Check & Reload completed.");
  const after = await status();
  expect(after.ownerId).toBe(before.ownerId);
  expect(after.savedVersion).not.toBe(before.savedVersion);
  expect(after.servingVersion).toBe(after.savedVersion);
});

test("does not start reload when the draft cannot be preserved", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = (): never => {
      throw new Error("Storage unavailable");
    };
  });
  let requests = 0;
  await page.route("**/api/reload", async (route) => {
    if (route.request().method() === "POST") requests += 1;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message" }).fill("Unsaved draft");
  await page.getByRole("button", { name: "Check & Reload" }).click();
  await expect(page.getByLabel("Reload status")).toContainText(
    "Check & Reload was not started because this draft could not be saved.",
  );
  expect(requests).toBe(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Unsaved draft");
});

test("a concurrent reload response does not hide subsequent status updates", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/reload");
  const value: unknown = await response.json();
  if (!Value.Check(ReloadStatusSchema, value)) throw new Error("Invalid reload status.");
  let posts = 0;
  await page.route("**/api/reload", async (route) => {
    const posting = route.request().method() === "POST";
    if (posting) posts += 1;
    await route.fulfill({
      status: posting ? 409 : 200,
      json: {
        ...value,
        phase: posting ? "checking" : "idle",
        message: posting ? "A reload is already running." : "No reload is running.",
      },
    });
  });
  await page.goto("/");
  await expect(page.getByLabel("Reload status")).toHaveText("No reload is running.");
  await page.getByRole("button", { name: "Check & Reload" }).click();
  await expect(page.getByLabel("Reload status")).toHaveText("A reload is already running.");
  await expect(page.getByLabel("Reload status")).toHaveText("No reload is running.");
  await expect(page.getByRole("button", { name: "Check & Reload" })).toBeEnabled();
  expect(posts).toBe(1);
});
