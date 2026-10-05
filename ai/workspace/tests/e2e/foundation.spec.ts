import { expect, test } from "@playwright/test";

test("submits a diagnostic message through the local server", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Browser-to-server check");
  await message.press("Enter");

  await expect(page.getByRole("status")).toHaveText("Server response: Browser-to-server check");
  await expect(message).toBeFocused();
});

test("disables duplicate submission while a request is pending", async ({ page }) => {
  let releaseRequest: (() => void) | undefined;
  let requestCount = 0;
  const requestGate = new Promise<undefined>((resolve) => {
    releaseRequest = (): void => resolve(undefined);
  });
  await page.route("**/api/diagnostic", async (route) => {
    requestCount += 1;
    await requestGate;
    await route.fulfill({
      body: JSON.stringify({ echo: "Request completed" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/");

  const message = page.getByRole("textbox", { name: "Message" });
  const submit = page.getByRole("button", { name: /Send test message|Checking connection/ });
  await message.fill("Hold this request");
  await submit.dblclick();

  await expect.poll(() => requestCount).toBe(1);
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText("Checking connection...");
  await expect(message).toHaveAttribute("readonly", "");

  if (releaseRequest === undefined) {
    throw new Error("The intercepted request did not start.");
  }
  releaseRequest();

  await expect(page.getByRole("status")).toHaveText("Server response: Request completed");
  await expect(submit).toBeEnabled();
});

test("retains the message after a recoverable request failure", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/diagnostic", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "unavailable" }),
      contentType: "application/json",
      status: 503,
    });
  });

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Retry this message");
  await page.getByRole("button", { name: "Send test message" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "The connection check could not be completed. Try again.",
  );
  await expect(message).toHaveValue("Retry this message");
});

test("retains the message after a network failure", async ({ page }) => {
  await page.route("**/api/diagnostic", async (route) => route.abort("failed"));
  await page.goto("/");

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Retry after network failure");
  await page.getByRole("button", { name: "Send test message" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "The connection check could not be completed. Try again.",
  );
  await expect(message).toHaveValue("Retry after network failure");
});

test("keeps long feedback usable at narrow size, enlarged text, and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ height: 640, width: 320 });
  await page.goto("/");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "125%";
  });

  const message = "x".repeat(200);
  const input = page.getByRole("textbox", { name: "Message" });
  const submit = page.getByRole("button", { name: "Send test message" });
  await input.fill(message);
  await submit.click();

  await expect(page.getByRole("status")).toHaveText(`Server response: ${message}`);
  await expect(submit).toBeInViewport();
  const transitionDurationSeconds = await submit.evaluate((element) => {
    const transitionDuration =
      element.ownerDocument.defaultView?.getComputedStyle(element).transitionDuration;
    return transitionDuration?.split(",").map(Number.parseFloat) ?? [];
  });
  expect(transitionDurationSeconds.every((duration) => duration <= 0.01)).toBe(true);
  const hasHorizontalOverflow = await page
    .locator("body")
    .evaluate((body) => body.scrollWidth > body.ownerDocument.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);

  await page.setViewportSize({ height: 720, width: 1280 });
  await expect(submit).toBeInViewport();
});
