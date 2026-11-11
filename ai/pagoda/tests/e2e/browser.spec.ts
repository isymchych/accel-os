import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, type Page } from "@playwright/test";
import { Value } from "typebox/value";

import type { Backend } from "../../src/backend/server.ts";
import {
  SnapshotSchema,
  WorkspaceSchema,
  type SessionKey,
  type SessionSnapshot,
  type WorkspaceState,
} from "../../src/desktop-api.ts";
import { test as base } from "./fixtures/backend.ts";
import { createNetwork } from "./fixtures/network.ts";

interface Workspace {
  backend: Backend;
  page: Page;
  directory: string;
}
async function state(page: Page): Promise<WorkspaceState> {
  const response = await page.request.get(`${new URL(page.url()).origin}/api/workspace`);
  const value: unknown = await response.json();
  assert.ok(Value.Check(WorkspaceSchema, value));
  return value;
}
async function snapshot(page: Page, key: SessionKey): Promise<SessionSnapshot> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`${origin}/api/snapshot`, {
    headers: { origin },
    data: { key },
  });
  const value: unknown = await response.json();
  assert.ok(Value.Check(SnapshotSchema, value));
  return value;
}

const test = base.extend<{ desktop: Workspace }>({
  desktop: async ({ page, testBackend }, use) => {
    await page.goto(testBackend.backend.connectionUrl);
    await expect(page.getByRole("status").first()).toContainText("connected");
    await use({ ...testBackend, page });
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

test("clients share execution but keep separate drafts and resynchronize after a network interruption", async ({
  desktop: { page, backend },
  browser,
}) => {
  const otherContext = await browser.newContext();
  const network = await createNetwork(backend.origin);
  try {
    await page.goto(`${network.origin}/${new URL(backend.connectionUrl).hash}`);
    await expect(page.getByRole("status").first()).toContainText("connected");
    const other = await otherContext.newPage();
    await other.goto(backend.connectionUrl);
    await expect(other.getByRole("status").first()).toContainText("connected");
    const draft = page.getByLabel("Message", { exact: true });
    await draft.fill("Keep my private draft");
    await expect(other.getByLabel("Message", { exact: true })).toHaveValue("");
    expect(new URL(page.url()).hash).toBe("");
    expect((await state(page)).initialKey).toBe((await state(other)).initialKey);
    network.disconnect();
    await expect(
      page.getByRole("alert").filter({ hasText: "Backend connection unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("status").first()).toContainText("unknown");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await other.getByLabel("Message", { exact: true }).fill("hold");
    await other.getByRole("button", { name: "Send", exact: true }).click();
    await expect(other.getByText("Running harmless-wait", { exact: true })).toBeVisible();
    network.reconnect();
    await expect(page.getByRole("status").first()).toContainText("running", { timeout: 10_000 });
    await expect(page.getByRole("article", { name: "Streaming response" })).toContainText(
      "Working",
    );
    await expect(draft).toHaveValue("Keep my private draft");
    await expect(
      page.getByRole("navigation", { name: "Open sessions" }).getByRole("button"),
    ).toHaveCount(1);
    await other.close();
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText("running");
    await expect(draft).toHaveValue("Keep my private draft");
  } finally {
    await network.close();
    await otherContext.close();
  }
});

test("an unauthenticated browser cannot read a workspace and gets connection instructions", async ({
  desktop: { backend },
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(backend.origin);
    await expect(page.getByRole("heading", { name: "Cannot connect to Pagoda" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("authenticate");
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("stopping the backend closes Pi and terminates active tool work", async ({
  desktop: { backend, page, directory },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
  const toolPid = Number(await readFile(path.join(directory, "tool-pid"), "utf8"));
  process.kill(toolPid, 0);
  await backend.close();
  expect(await readFile(path.join(directory, "closed"), "utf8")).toBe("clean");
  assert.throws(() => process.kill(toolPid, 0), { code: "ESRCH" });
});

test("directory selection, independent drafts, and a pending Stop stay bound to their sessions", async ({
  desktop: { page, directory },
}) => {
  const other = path.join(directory, "other-project");
  await mkdir(other);
  const initialKey = (await state(page)).initialKey;
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Running harmless-wait", { exact: true })).toBeVisible();
  await message.fill("A draft");
  await page.getByLabel("Working directory", { exact: true }).fill(other);
  await page.getByRole("button", { name: "Use directory", exact: true }).click();
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
  await expect.poll(async () => (await snapshot(page, initialKey)).execution).toBe("idle");
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
  const initialKey = (await state(page)).initialKey;
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
  expect((await snapshot(page, initialKey)).execution).toBe("running");
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
  await expect(page.getByText("1 queued inputs", { exact: true })).toBeVisible();
  await message.fill("explicit steering");
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await expect(message).toHaveValue("");
  await expect(page.getByText("2 queued inputs", { exact: true })).toBeVisible();
  const queued = (await readFile(path.join(directory, "queue.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(queued).toEqual([
    expect.objectContaining({ type: "follow_up", message: "explicit follow-up" }),
    expect.objectContaining({ type: "steer", message: "explicit steering" }),
  ]);
});

test("history refreshes independently and a late response cannot overwrite a newer refresh", async ({
  desktop: { page },
}) => {
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("fake/fixture");
  await page.getByRole("button", { name: "History and branches", exact: true }).click();
  let controlsRequests = 0;
  await page.route("**/api/controls", async (route) => {
    controlsRequests += 1;
    await route.continue();
  });
  let calls = 0;
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  await page.route("**/api/history", async (route) => {
    const response = await route.fetch();
    calls += 1;
    const first = calls === 1;
    requested.resolve(undefined);
    if (first) await release.promise;
    await route.fulfill({
      response,
      json: {
        entries: [{ id: "entry", parentId: null, label: first ? "old history" : "new history" }],
        leafId: "entry",
      },
    });
  });
  const refresh = page.getByRole("button", { name: "Refresh history", exact: true });
  await refresh.click();
  await requested.promise;
  await refresh.click();
  const history = page.getByRole("combobox", { name: "History entry", exact: true });
  await expect(history).toContainText("new history");
  const delivered = page.waitForResponse("**/api/history");
  release.resolve(undefined);
  await delivered;
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        globalThis.window.requestAnimationFrame(() => {
          globalThis.window.requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  await expect(history).toContainText("new history");
  await expect(model).toContainText("fake/fixture");
  expect(controlsRequests).toBe(0);
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

test("reloading during Send preserves the draft and reports an uncertain outcome", async ({
  desktop: { page, directory },
}) => {
  await writeFile(path.join(directory, "delay-prompt"), "delay");
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("delayed");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => readFile(path.join(directory, "prompt-pending"), "utf8").catch(() => ""))
    .toBe("pending");
  await page.reload();
  await expect(message).toHaveValue("delayed");
  await expect(page.getByRole("region", { name: "Direct agent" }).getByRole("alert")).toContainText(
    "outcome is uncertain",
  );
  await writeFile(path.join(directory, "release-prompt"), "release");
  const prompts = (await readFile(path.join(directory, "prompts.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(prompts).toEqual([{ message: "delayed" }]);
});

test("rejected model changes and navigation keep confirmed controls and transcript", async ({
  desktop: { page },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("preserved history");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const assistant = page.getByRole("article", { name: "assistant message" });
  await expect(assistant).toContainText("Hello from fake Pi.");
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("fake/fixture");
  // Inject transport-level rejection; Node tests cover Pi rejection.
  for (const operation of ["model", "navigate"]) {
    await page.route(`**/api/${operation}`, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        json: { error: `Rejected ${operation} for test` },
      });
    });
  }
  await model.click();
  await page.getByRole("option", { name: "fake/Other", exact: true }).click();
  const controls = page.getByRole("region", { name: "Session controls" });
  await expect(controls.getByRole("alert")).toContainText("Rejected model");
  await expect(model).toContainText("fake/fixture");
  await expect(model).toBeEnabled();
  await page.getByRole("button", { name: "History and branches", exact: true }).click();
  await page.getByRole("combobox", { name: "History entry", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "user: preserved history" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(controls.getByRole("alert")).toContainText("Rejected navigate");
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
  const initialKey = (await state(page)).initialKey;
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
  expect((await snapshot(page, initialKey)).execution).toBe("running");
});
