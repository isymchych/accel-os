import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { expect, type Page } from "@playwright/test";
import { Schema } from "effect";

import type { Backend } from "../../src/backend/server.ts";
import {
  SnapshotSchema,
  WorkspaceSchema,
  type SessionKey,
  type SessionSnapshot,
  type WorkspaceState,
} from "../../src/contracts/index.ts";
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
  assert.ok(Schema.is(WorkspaceSchema)(value));
  return value;
}
async function snapshot(page: Page, key: SessionKey): Promise<SessionSnapshot> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`${origin}/api/snapshot`, {
    headers: { origin },
    data: { key },
  });
  const value: unknown = await response.json();
  assert.ok(Schema.is(SnapshotSchema)(value));
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
  await expect(page.getByText("Input: started.", { exact: true })).toHaveCount(0);
});

test("proxied SVG renders as an image but cannot execute when opened directly", async ({
  desktop: { backend, page },
}) => {
  const server = createServer((request, response) => {
    if (request.url === "/image.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      return;
    }
    response.writeHead(200, { "content-type": "image/svg+xml" });
    response.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
        <script>document.documentElement.setAttribute("data-executed", "yes")</script>
        <rect width="10" height="10" fill="red"/>
      </svg>`,
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const url = `${backend.origin}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${address.port}/image.svg`)}`;
    const pngUrl = `${backend.origin}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${address.port}/image.png`)}`;
    for (const [src, width] of [
      [url, 10],
      [pngUrl, 1],
    ] as const) {
      const imageLoaded = await page.evaluate(async (imageSrc) => {
        const image = new globalThis.Image();
        image.src = imageSrc;
        await image.decode();
        return image.naturalWidth;
      }, src);
      expect(imageLoaded).toBe(width);
    }

    await page.goto(url);
    await expect(page.locator("svg")).toHaveCount(1);
    await expect(page.locator("svg")).not.toHaveAttribute("data-executed", "yes");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
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

test("the workspace keeps its composer visible across window sizes and long drafts", async ({
  desktop: { page },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  const composer = page.getByRole("region", { name: "Direct agent" });
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("fake/fixture");
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "What are we working on?" })).toBeVisible();
    for (const draft of ["", "A line of a long draft\n".repeat(100)]) {
      await message.fill(draft);
      const bounds = await composer.boundingBox();
      assert.ok(bounds);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      await expect(model).toBeInViewport();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBe(
        viewport.width,
      );
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollHeight)).toBe(
        viewport.height,
      );
    }
  }
  const sessionsToggle = page.getByRole("button", { name: "Sessions", exact: true });
  await expect(sessionsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Recent sessions" })).toBeHidden();
  await sessionsToggle.click();
  await expect(page.getByRole("navigation", { name: "Recent sessions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New session", exact: true })).toBeInViewport();
  await sessionsToggle.click();
  await expect(page.getByRole("navigation", { name: "Recent sessions" })).toBeHidden();
  await expect(message).toHaveValue("A line of a long draft\n".repeat(100));
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  const followUp = page.getByRole("button", { name: "Follow up", exact: true });
  for (const action of ["Follow up", "Steer", "Stop"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toBeInViewport();
  }
  const controlsBounds = await page.getByRole("region", { name: "Session controls" }).boundingBox();
  const actionsBounds = await followUp.boundingBox();
  assert.ok(controlsBounds && actionsBounds);
  expect(controlsBounds.y + controlsBounds.height).toBeLessThanOrEqual(actionsBounds.y);
});

test("session library search filters history without changing open sessions", async ({
  desktop: { page },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("saved history");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await page.getByRole("button", { name: "Browse sessions", exact: true }).click();
  const saved = page.getByRole("region", { name: "Sessions" });
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  const search = page.getByRole("searchbox", { name: "Search sessions" });
  await search.fill("no matching session");
  await expect(saved.getByRole("listitem")).toHaveCount(0);
  await expect(saved.getByText("No matching sessions.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button"),
  ).toHaveCount(1);
  await search.fill("SAVED HISTORY");
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  await search.clear();
  await saved.getByRole("listitem").getByRole("button").first().click();
  await expect(page.getByRole("article", { name: "user message" })).toContainText("saved history");
});

test("session library filters sessions across working directories", async ({
  desktop: { page, directory },
}) => {
  const other = path.join(directory, "other-project");
  await mkdir(other);
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("first project");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await page.getByLabel("Working directory", { exact: true }).fill(other);
  await page.getByRole("button", { name: "Use directory", exact: true }).click();
  await expect(page.getByRole("complementary")).toContainText(other);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(page.getByRole("article", { name: "user message" })).toHaveCount(0);
  await message.fill("second project");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "user message" })).toContainText("second project");
  await page.getByRole("button", { name: "Browse sessions", exact: true }).click();
  const library = page.getByRole("region", { name: "Sessions" });
  await expect(library.getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Filter by directory").selectOption(other);
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await library.getByRole("listitem").getByRole("button").first().click();
  await expect(message).toBeVisible();
  await expect(page.getByRole("article", { name: "user message" })).toContainText("second project");
  await expect(
    page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button"),
  ).toHaveCount(2);
});

test("pin and favourite changes are shared between clients", async ({
  desktop: { page, backend },
  browser,
}) => {
  await page.getByLabel("Message", { exact: true }).fill("important work");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(backend.connectionUrl);
    await expect(other.getByRole("status").first()).toContainText("connected");
    await page.getByRole("button", { name: "Browse sessions", exact: true }).click();
    const library = page.getByRole("region", { name: "Sessions" });
    await expect(library.getByRole("listitem")).toHaveCount(1);
    await library.getByRole("button", { name: "Pin important work" }).click();
    await expect(other.getByRole("navigation", { name: "Pinned sessions" })).toContainText(
      "important work",
    );
    await library.getByRole("button", { name: "Favourite important work" }).click();
    await other.getByRole("button", { name: "Browse sessions", exact: true }).click();
    await other.getByLabel("Favourites only").check();
    await expect(other.getByRole("region", { name: "Sessions" }).getByRole("listitem")).toHaveCount(
      1,
    );
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Pinned sessions" })).toContainText(
      "important work",
    );
  } finally {
    await context.close();
  }
});

test("inactive sessions leave Recent without deleting history, while pinned sessions remain", async ({
  desktop: { page },
}) => {
  await page.clock.install();
  await page.getByLabel("Message", { exact: true }).fill("older work");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const recent = page.getByRole("navigation", { name: "Recent sessions" });
  await expect(recent.getByRole("button")).toHaveCount(2);
  await page.clock.fastForward("49:00:00");
  await expect(recent.getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Browse sessions", exact: true }).click();
  const library = page.getByRole("region", { name: "Sessions" });
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await library.getByRole("button", { name: "Pin older work" }).click();
  const pinned = page.getByRole("navigation", { name: "Pinned sessions" });
  await expect(pinned.getByRole("button")).toHaveCount(1);
  await pinned.getByRole("button").click();
  await expect(page.getByRole("article", { name: "user message" })).toContainText("older work");
});

test("Recent follows refreshed native activity without renewing on reopen", async ({
  desktop: { page, directory },
}) => {
  const recent = page.getByRole("navigation", { name: "Recent sessions" });
  const file = path.join(directory, "native", "external.jsonl");
  const nativeHistory = (time: number): string =>
    [
      {
        type: "session",
        version: 3,
        id: "external-session",
        cwd: directory,
        timestamp: new Date(time).toISOString(),
      },
      {
        type: "message",
        id: "external-message",
        parentId: null,
        timestamp: new Date(time).toISOString(),
        message: { role: "user", content: "External history", timestamp: time },
      },
      {
        type: "session_info",
        id: "external-name",
        parentId: "external-message",
        timestamp: new Date(time).toISOString(),
        name: "External session",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
  await writeFile(file, nativeHistory(Date.now() - 49 * 60 * 60 * 1000));
  await page.getByRole("button", { name: "Refresh sessions" }).click();
  await expect(recent.getByRole("button", { name: /External session/u })).toHaveCount(0);
  await page.getByRole("button", { name: "Browse sessions", exact: true }).click();
  await page
    .getByRole("region", { name: "Sessions" })
    .getByRole("button", { name: /^External session /u })
    .click();
  await expect(recent.getByRole("button", { name: /External session/u })).toHaveCount(1);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(recent.getByRole("button", { name: /External session/u })).toHaveCount(0);
  await writeFile(file, nativeHistory(Date.now()));
  await page.getByRole("button", { name: "Refresh sessions" }).click();
  await expect(recent.getByRole("button", { name: /External session/u })).toHaveCount(1);
});

test("running work and unsent drafts remain in Recent after expiry", async ({
  desktop: { page },
}) => {
  await page.clock.install();
  const message = page.getByLabel("Message", { exact: true });
  const recent = page.getByRole("navigation", { name: "Recent sessions" });
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(recent.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("status").first()).toContainText("idle");
  await message.fill("draft to preserve");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(recent.getByRole("button")).toHaveCount(3);
  await page.clock.fastForward("49:00:00");
  await expect(recent.getByRole("button")).toHaveCount(3);
  await recent.getByRole("button").nth(1).click();
  await expect(message).toHaveValue("draft to preserve");
});

test("rejected input preserves the draft across renderer reload", async ({ desktop: { page } }) => {
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("reject");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("region", { name: "Direct agent" }).getByRole("alert")).toContainText(
    "Rejected test prompt",
  );
  await expect(page.getByRole("region", { name: "Direct agent" }).getByRole("alert")).toHaveCount(
    1,
  );
  await expect(message).toHaveValue("reject");
  await page.reload();
  await expect(message).toHaveValue("reject");
});

test("accepted input with a lost acknowledgement preserves its draft without replay", async ({
  desktop: { page, directory },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  await page.route("**/api/prompt", async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  });
  await message.fill("uncertain");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("region", { name: "Direct agent" }).getByRole("alert")).toContainText(
    "outcome is uncertain",
  );
  await expect(message).toHaveValue("uncertain");
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText("connected");
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
      page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button"),
    ).toHaveCount(1);
    network.disconnect();
    await expect(
      page.getByRole("button", { name: "harmless-wait · unconfirmed", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article", { name: "Streaming response" })).toContainText(
      "Execution unknown · unfinished",
    );
    network.reconnect();
    await expect(
      page.getByRole("button", { name: "harmless-wait · running", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
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
  const sessions = page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button");
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
  await expect(page.getByRole("button", { name: "Stopping…", exact: true })).toBeDisabled();
  await expect(page.getByText("Stopped.", { exact: true })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Browse sessions", exact: true }).click();
  const saved = page.getByRole("region", { name: "Sessions" });
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  await saved.getByRole("listitem").getByRole("button").first().click();
  const sessions = page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button");
  await expect(sessions).toHaveCount(1);
  await message.fill("hold");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("running");
  await page.getByRole("button", { name: "Conversation history", exact: true }).click();
  const historyEntries = page.getByRole("region", { name: "History entries" });
  await historyEntries.getByRole("button").filter({ hasText: "assistant: Hello" }).click();
  await expect(page.getByRole("button", { name: "Navigate", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Fork session", exact: true }).click();
  await expect(sessions).toHaveCount(2);
  await expect(page.getByRole("article", { name: "user message" })).toHaveCount(1);
  await expect(page.getByRole("article", { name: "user message" })).toContainText(
    "original history",
  );
  expect((await snapshot(page, initialKey)).execution).toBe("running");
  await page.getByRole("button", { name: "Conversation history", exact: true }).click();
  await historyEntries.getByRole("button").filter({ hasText: "user: original history" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toHaveCount(0);
  await expect(message).toHaveValue("original history");
  await page.reload();
  await expect(message).toHaveValue("original history");
  await page.getByRole("button", { name: "Conversation history", exact: true }).click();
  await historyEntries.getByRole("button").filter({ hasText: "assistant: Hello" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await expect(message).toHaveValue("original history");
});

test("history browsing preserves branches, drafts, and focus until an explicit action", async ({
  desktop: { page },
}) => {
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("original branch");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Conversation history", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const entries = dialog.getByRole("region", { name: "History entries" });
  await entries.getByRole("button").filter({ hasText: "user: original branch" }).click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(message).toHaveValue("original branch");
  await message.fill("replacement branch");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toBeVisible();
  await message.fill("Keep my draft while browsing");
  await trigger.click();
  const original = entries.getByRole("button").filter({ hasText: "user: original branch" });
  await expect(original).toContainText("Other branch");
  await expect(
    entries.getByRole("button").filter({ hasText: "user: replacement branch" }),
  ).toContainText("Active branch");
  await expect(entries.getByRole("button").filter({ hasText: "Current position" })).toHaveCount(1);
  await original.click();
  await expect(message).toHaveValue("Keep my draft while browsing");
  await expect(page.getByRole("article", { name: "user message", includeHidden: true })).toHaveText(
    /replacement branch/u,
  );
  await expect(dialog.getByRole("region", { name: "Selected history entry" })).toContainText(
    "Original history is preserved",
  );
  const search = dialog.getByRole("searchbox", { name: "Search history" });
  await search.fill("ORIGINAL BRANCH");
  await expect(entries.getByRole("listitem")).toHaveCount(1);
  await search.fill("does not exist");
  await expect(entries).toContainText("No matching entries.");
  await expect(dialog.getByRole("region", { name: "Selected history entry" })).toContainText(
    "user: original branch",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(message).toHaveValue("Keep my draft while browsing");
});

test("history fork failures remain local and long histories fit desktop and narrow windows", async ({
  desktop: { page },
}) => {
  // Synthetic history isolates layout and action feedback; other journeys exercise native branches.
  await page.route("**/api/history", async (route) => {
    await route.fulfill({
      json: {
        entries: Array.from({ length: 100 }, (_, index) => ({
          id: `entry-${index}`,
          parentId: index === 0 ? null : `entry-${index - 1}`,
          label: `user: ${index} ${"Long history entry ".repeat(12)}`,
        })),
        leafId: "entry-99",
      },
    });
  });
  let forks = 0;
  await page.route("**/api/fork", async (route) => {
    forks += 1;
    await route.fulfill({ status: 400, json: { error: "Fork rejected for test" } });
  });
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("Preserve this draft");
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Conversation history", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const entries = dialog.getByRole("region", { name: "History entries" });
    await expect(entries.getByRole("listitem")).toHaveCount(100);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await expect(page.getByRole("button", { name: "Navigate", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Fork session", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Fork rejected for test");
    await expect(page.getByRole("button", { name: "Fork session", exact: true })).toBeEnabled();
    await expect(message).toHaveValue("Preserve this draft");
    await page.getByRole("button", { name: "Close history", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("article", { name: "user message" })).toHaveCount(0);
  }
  expect(forks).toBe(2);
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
  await expect(page.getByText("Input: queued.", { exact: true })).toHaveCount(0);
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

test("catalog refresh errors are visible and an explicit refresh recovers", async ({
  desktop: { page },
}) => {
  await page.route("**/api/list-all", async (route) => {
    await route.fulfill({ status: 500, json: { error: "Catalog unavailable" } });
  });
  await page.getByRole("button", { name: "Refresh sessions" }).click();
  await expect(page.getByRole("alert")).toContainText("Catalog unavailable");
  await page.unroute("**/api/list-all");
  const recovered = page.waitForResponse("**/api/list-all");
  await page.getByRole("button", { name: "Refresh sessions" }).click();
  expect((await recovered).ok()).toBe(true);
  await expect(page.getByText("Catalog unavailable", { exact: true })).toHaveCount(0);
});

test("a pending model change stays with its session across view switches", async ({
  desktop: { page },
}) => {
  // An empty, idle session has no native activity and otherwise leaves Recent.
  await page.getByLabel("Message", { exact: true }).fill("Keep the first session visible");
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  await page.route("**/api/model", async (route) => {
    const response = await route.fetch();
    requested.resolve(undefined);
    await release.promise;
    await route.fulfill({ response });
  });
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await model.click();
  await page.getByRole("option", { name: "fake/Other", exact: true }).click();
  await requested.promise;
  try {
    await expect(model).toBeDisabled();
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await expect(model).toContainText("fake/fixture");
    await expect(model).toBeEnabled();
    await expect(
      page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button"),
    ).toHaveCount(2);
    await page
      .getByRole("navigation", { name: "Recent sessions" })
      .getByRole("button")
      .first()
      .click();
    await expect(model).toBeDisabled();
    release.resolve(undefined);
    await expect(model).toBeEnabled();
    await expect(model).toContainText("fake/other");
  } finally {
    release.resolve(undefined);
  }
});

test("history refreshes independently and a late response cannot overwrite a newer refresh", async ({
  desktop: { page },
}) => {
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("fake/fixture");
  await page.getByRole("button", { name: "Conversation history", exact: true }).click();
  let controlsRequests = 0;
  await page.route("**/api/controls", async (route) => {
    controlsRequests += 1;
    await route.continue();
  });
  let calls = 0;
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const settled = Promise.withResolvers<undefined>();
  await page.route("**/api/history", async (route) => {
    const response = await route.fetch();
    calls += 1;
    const first = calls === 1;
    requested.resolve(undefined);
    if (first) await release.promise;
    try {
      await route.fulfill({
        response,
        json: {
          entries: [{ id: "entry", parentId: null, label: first ? "old history" : "new history" }],
          leafId: "entry",
        },
      });
    } finally {
      if (first) settled.resolve(undefined);
    }
  });
  const refresh = page.getByRole("button", { name: "Refresh history", exact: true });
  await refresh.click();
  await requested.promise;
  await refresh.click();
  const history = page.getByRole("region", { name: "History entries" });
  await expect(history).toContainText("new history");
  release.resolve(undefined);
  await settled.promise;
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
  await page.getByRole("button", { name: "Close history", exact: true }).click();
  await expect(model).toContainText("fake/fixture");
  expect(controlsRequests).toBe(0);
});

test("idle follow-up and steering execute immediately", async ({ desktop: { page } }) => {
  const message = page.getByLabel("Message", { exact: true });
  for (const [index, action] of ["Follow up", "Steer"].entries()) {
    await message.fill(`Idle ${action}`);
    await page.getByRole("button", { name: "More input actions", exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^${action}`, "u") }).click();
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
  await expect(page.getByRole("region", { name: "Direct agent" })).toContainText(
    "Waiting for Pi to confirm input",
  );
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const sessions = page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button");
  await expect(sessions).toHaveCount(2);
  await expect(page.getByRole("status").first()).toContainText("idle");
  await message.fill("B must keep this draft");
  // Registry-owned atoms must retain their owner's identity even when the view releases it.
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("HeapProfiler.collectGarbage");
  } finally {
    await cdp.detach();
  }
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
  await page.getByRole("button", { name: "Conversation history", exact: true }).click();
  await page
    .getByRole("region", { name: "History entries" })
    .getByRole("button")
    .filter({ hasText: "user: preserved history" })
    .click();
  await page.getByRole("button", { name: "Navigate", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Rejected navigate");
  await expect(page.getByRole("button", { name: "Navigate", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Close history", exact: true }).click();
  await expect(controls.getByRole("alert")).toContainText("Rejected model");
  await expect(assistant).toContainText("Hello from fake Pi.");
  await expect(page.getByRole("article", { name: "user message" })).toContainText(
    "preserved history",
  );
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
  const clipped = output.locator(".max-h-80");
  await expect(clipped).toHaveCount(1);
  await output.getByRole("button", { name: /Show full content/u }).click();
  await expect(output).toContainText("END_OF_LONG_OUTPUT");
  await output.getByRole("button", { name: "Show less", exact: true }).click();
  await expect(clipped).toHaveCount(1);
});

test("native assistant thinking and tool images preserve content order", async ({
  desktop: { page },
}) => {
  await page.getByLabel("Message", { exact: true }).fill("ordered-content");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const output = page.getByRole("article", { name: "assistant message" });
  await expect(output.getByRole("button", { name: "Thinking" })).toBeVisible();
  const order = await output
    .locator(":scope > div > div")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.querySelector("img") ? "image" : element.textContent.trim(),
      ),
    );
  expect(order).toEqual(["First text", "Thinking", "Last text"]);
  await output.getByRole("button", { name: "Thinking" }).click();
  await expect(output).toContainText("Private reasoning");
  const result = page.getByRole("article", { name: "toolResult message" });
  await expect(result.getByRole("img", { name: "Attached content" })).toBeVisible();
  const toolOrder = await result
    .locator(":scope > div > div")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.querySelector("img") ? "image" : element.textContent.trim(),
      ),
    );
  expect(toolOrder).toEqual(["Tool: image-fixture", "Before image", "image", "After image"]);
});

test("assistant Markdown and compact tools remain readable without executing content", async ({
  desktop: { page },
}) => {
  const remoteRequests: string[] = [];
  await page.route("**/api/image?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "example.com") remoteRequests.push(request.url());
  });
  await page.getByLabel("Message", { exact: true }).fill("transcript-demo");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const output = page.getByRole("article", { name: "assistant message" });
  await expect(output.getByRole("heading", { name: "Workspace review" })).toBeVisible();
  await expect(output.locator("strong")).toHaveText("session ownership");
  await expect(output.getByRole("listitem")).toHaveCount(2);
  await expect(output.getByRole("table")).toContainText("Preserved");
  await expect(output.getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(output.getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "rel",
    "noreferrer",
  );
  await expect(output.getByRole("link", { name: "Unsafe link" })).toHaveCount(0);
  const image = output.getByRole("img", { name: "Remote image" });
  await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(image).toHaveAttribute("src", /\/api\/image\?url=/u);
  await expect(output.locator("script")).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
  const tools = page.getByRole("region", { name: "Tool activity" });
  await expect(tools.getByRole("button", { name: "read · completed", exact: true })).toContainText(
    "src/renderer/session/session-view.tsx",
  );
  const failed = tools.getByRole("button", { name: "bash · error", exact: true });
  await expect(failed).toContainText("pnpm run check");
  await expect(tools.getByText(/Typecheck failed: missing fixture/u)).toBeVisible();
  await expect(tools.getByText("Read 120 lines.", { exact: true })).toHaveCount(0);
  await failed.click();
  await expect(tools.getByRole("heading", { name: "Arguments", exact: true })).toBeVisible();
  await expect(tools.locator("img")).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBe(width);
    const code = output.locator("pre");
    expect(await code.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  }
});

test("streaming follows the bottom but preserves the reader's position until Jump to latest", async ({
  desktop: { page },
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const input = page.getByLabel("Message", { exact: true });
  await input.fill("transcript-stream");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const transcript = page.getByRole("region", { name: "Session transcript" }).locator("..");
  const distance = async (): Promise<number> =>
    transcript.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    );
  await expect(page.getByRole("article", { name: "Streaming response" })).toContainText(
    "Investigation",
  );
  await expect.poll(distance).toBeLessThanOrEqual(1);
  const composerPosition = await input.boundingBox();
  await input.fill("__transcript_chunk__");
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  await expect(page.getByRole("article", { name: "Streaming response" })).toContainText(
    "Another finding",
  );
  await expect.poll(distance).toBeLessThanOrEqual(1);
  await transcript.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(async () => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
  const before = await page.getByRole("article", { name: "Streaming response" }).innerText();
  await input.fill("__transcript_chunk__");
  await page.getByRole("button", { name: "Follow up", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.getByRole("article", { name: "Streaming response" }).innerText()).length,
    )
    .toBeGreaterThan(before.length);
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect.poll(distance).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
  expect(await input.boundingBox()).toEqual(composerPosition);
});

test("keyboard navigation scrolls and focuses the composer without intercepting typing", async ({
  desktop: { page },
}) => {
  const transcript = page
    .getByRole("region", { name: "Session transcript", includeHidden: true })
    .locator("..");
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
  await expect.poll(async () => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  const composerPosition = await message.boundingBox();
  await page.keyboard.press("j");
  await expect
    .poll(async () => transcript.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.keyboard.press("k");
  await expect.poll(async () => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press("Control+d");
  const halfPage = await transcript.evaluate((element) => element.clientHeight / 2);
  await expect
    .poll(async () =>
      Math.abs((await transcript.evaluate((element) => element.scrollTop)) - halfPage),
    )
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("Control+u");
  await expect
    .poll(async () => transcript.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("Shift+g");
  await expect
    .poll(async () =>
      transcript.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  expect(await message.boundingBox()).toEqual(composerPosition);
  expect(await page.evaluate(() => globalThis.window.scrollY)).toBe(0);
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
  const sessions = page.getByRole("navigation", { name: "Recent sessions" }).getByRole("button");
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
  const transcript = page
    .getByRole("region", { name: "Session transcript", includeHidden: true })
    .locator("..");
  const scrollBefore = await transcript.evaluate((element) => element.scrollTop);
  await page.keyboard.press("[");
  await page.keyboard.press("j");
  await page.keyboard.press("i");
  await expect(help).toBeVisible();
  await expect(message).not.toBeFocused();
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(message).toHaveValue("B draft");
  await page.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Close", exact: true }).click();
  expect((await snapshot(page, initialKey)).execution).toBe("running");
});
