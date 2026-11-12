import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { startBackend, type Backend } from "../../src/backend/server.ts";

test("SDK browser sessions capture the shared account selection without retargeting existing owners", async ({
  page,
  context,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-browser-"));
  const agentDir = path.join(root, "ai/pi");
  const sharedDir = path.join(root, "ai");
  const profiles = [".pi-account-a", ".pi-account-b"];
  const credentials: Array<string | undefined> = [];
  const provider = createServer((request, response) => {
    credentials.push(request.headers.authorization);
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const [delta, finish] of [
      [{ role: "assistant", content: "SDK response" }, null],
      [{}, "stop"],
    ] as const) {
      response.write(
        `data: ${JSON.stringify({
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    }
    response.end("data: [DONE]\n\n");
  });
  let backend: Backend | undefined;
  try {
    for (const profile of profiles) {
      const directory = path.join(agentDir, "profiles", profile);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "auth.json"),
        JSON.stringify({ "sdk-fixture": { type: "api_key", key: profile } }),
      );
    }
    await writeFile(path.join(sharedDir, "SYSTEM.md"), "Synthetic browser fixture");
    await new Promise<void>((resolve) => {
      provider.listen(0, "127.0.0.1", resolve);
    });
    const address = provider.address();
    assert.ok(address !== null && typeof address !== "string");
    await writeFile(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "sdk-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            models: [{ id: "fixture", contextWindow: 128_000, maxTokens: 1_000 }],
          },
        },
      }),
    );
    const sessionDir = path.join(agentDir, "sessions");
    backend = await startBackend({
      port: 0,
      pi: {
        cwd: root,
        agentDir,
        profileDir: path.join(agentDir, "profiles", ".pi-account-a"),
        sessionDir,
        sharedDir,
      },
      accountConfigDir: agentDir,
      clientDirectory: path.resolve(import.meta.dirname, "../../dist/client"),
    });
    await page.goto(backend.connectionUrl);
    const account = page.getByRole("combobox", { name: "Account for new sessions" });
    await expect(account).toContainText(".pi-account-a");
    await expect(account).toBeEnabled();
    const other = await context.newPage();
    await other.goto(backend.origin);
    await expect(other.getByRole("combobox", { name: "Account for new sessions" })).toContainText(
      ".pi-account-a",
    );
    await account.click();
    await page.getByRole("option", { name: ".pi-account-b", exact: true }).click();
    await expect(account).toContainText(".pi-account-b");
    await expect(other.getByRole("combobox", { name: "Account for new sessions" })).toContainText(
      ".pi-account-b",
    );
    const model = page.getByRole("combobox", { name: "Model", exact: true });
    await model.click();
    await page.getByRole("option", { name: "sdk-fixture/fixture", exact: true }).click();
    await expect(model).toContainText("sdk-fixture/fixture");
    const message = page.getByLabel("Message", { exact: true });
    await message.fill("Existing owner");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("article", { name: "assistant message" })).toContainText(
      "SDK response",
    );
    await page.getByRole("button", { name: "New session", exact: true }).click();
    await expect(page.getByRole("article", { name: "assistant message" })).toHaveCount(0);
    await expect(model).toBeEnabled();
    await model.click();
    await page.getByRole("option", { name: "sdk-fixture/fixture", exact: true }).click();
    await expect(model).toContainText("sdk-fixture/fixture");
    await message.fill("New owner");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("article", { name: "assistant message" })).toContainText(
      "SDK response",
    );
    expect(credentials).toEqual(["Bearer .pi-account-a", "Bearer .pi-account-b"]);
    await other.close();
  } finally {
    await backend?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await rm(root, { recursive: true, force: true });
  }
});
