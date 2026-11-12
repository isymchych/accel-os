import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Effect } from "effect";

import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import { runScoped } from "./fixtures/helpers.ts";

test(
  "SDK workspace executes, observes, and navigates native history",
  { timeout: 15_000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-workspace-"));
    const shared = path.join(root, "ai");
    const agent = path.join(shared, "pi");
    const profile = path.join(agent, "profiles", ".pi-account-a");
    const otherProfile = path.join(agent, "profiles", ".pi-account-b");
    const project = path.join(root, "project");
    const sessionDir = path.join(root, "sessions");
    await Promise.all(
      [
        path.join(shared, "skills"),
        path.join(shared, "prompts"),
        agent,
        profile,
        otherProfile,
        project,
      ].map(async (directory) => mkdir(directory, { recursive: true })),
    );
    await Promise.all([
      writeFile(path.join(shared, "SYSTEM.md"), "Synthetic fixture"),
      writeFile(
        path.join(profile, "auth.json"),
        JSON.stringify({ "sdk-fixture": { type: "api_key", key: "account-a" } }),
      ),
      writeFile(
        path.join(otherProfile, "auth.json"),
        JSON.stringify({ "sdk-fixture": { type: "api_key", key: "account-b" } }),
      ),
      writeFile(path.join(agent, "active-account.json"), '{"profile":".pi-account-b"}'),
    ]);
    const credentials: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      credentials.push(request.headers.authorization);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finishReason] of [
        [{ role: "assistant", content: "Synthetic response" }, null],
        [{}, "stop"],
      ] as const) {
        response.write(
          `data: ${JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      }
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    await writeFile(
      path.join(agent, "models.json"),
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
    const workspace = await runScoped(
      t,
      DesktopWorkspace.make(
        {
          cwd: project,
          agentDir: agent,
          profileDir: profile,
          sessionDir,
          sharedDir: shared,
        },
        undefined,
        48,
        agent,
      ),
    );
    t.after(async () => {
      await Effect.runPromise(workspace.close());
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(root, { recursive: true, force: true });
    });

    assert.equal((await Effect.runPromise(workspace.snapshot())).selectedAccount, ".pi-account-a");
    const owner = await Effect.runPromise(workspace.session(workspace.initialKey));
    await Effect.runPromise(owner.model("sdk-fixture", "fixture"));
    assert.equal((await Effect.runPromise(owner.controls())).model?.id, "fixture");
    const settled = Promise.withResolvers<undefined>();
    owner.subscribe((snapshot) => {
      if (
        snapshot.execution === "idle" &&
        snapshot.messages.some((message) =>
          JSON.stringify(message.content).includes("Synthetic response"),
        )
      ) {
        settled.resolve(undefined);
      }
    });
    assert.equal(await Effect.runPromise(owner.prompt("First prompt")), "started");
    await settled.promise;
    assert.equal(owner.snapshot().connection, "connected");
    const persisted = owner.snapshot().sessionFile;
    assert.ok(persisted);
    const reopened = await Promise.all([
      Effect.runPromise(workspace.open(project, persisted)),
      Effect.runPromise(workspace.open(project, persisted)),
    ]);
    assert.ok(reopened.every((snapshot) => snapshot.key === workspace.initialKey));
    assert.ok(
      (await Effect.runPromise(workspace.list(project))).some(
        (stored) => stored.path === persisted,
      ),
    );
    const history = await Effect.runPromise(owner.history());
    const firstUser = history.entries.find((entry) => entry.label.startsWith("user: First prompt"));
    assert.ok(firstUser);
    assert.equal(await Effect.runPromise(owner.navigate(firstUser.id)), "First prompt");
    assert.ok(!owner.snapshot().messages.some((message) => message.role === "user"));
    await Effect.runPromise(workspace.selectAccount(".pi-account-b"));
    const created = await Effect.runPromise(workspace.create(project));
    const next = await Effect.runPromise(workspace.session(created.key));
    await Effect.runPromise(next.model("sdk-fixture", "fixture"));
    const nextSettled = Promise.withResolvers<undefined>();
    next.subscribe((snapshot) => {
      if (
        snapshot.execution === "idle" &&
        snapshot.messages.some((message) => message.role === "assistant")
      )
        nextSettled.resolve(undefined);
    });
    assert.equal(await Effect.runPromise(next.prompt("Second prompt")), "started");
    await nextSettled.promise;
    const originalSettled = Promise.withResolvers<undefined>();
    owner.subscribe((snapshot) => {
      if (
        snapshot.execution === "idle" &&
        snapshot.messages.some((message) =>
          JSON.stringify(message.content).includes("Original owner again"),
        )
      )
        originalSettled.resolve(undefined);
    });
    assert.equal(await Effect.runPromise(owner.prompt("Original owner again")), "started");
    await originalSettled.promise;
    assert.deepEqual(credentials, ["Bearer account-a", "Bearer account-b", "Bearer account-a"]);
    await Effect.runPromise(owner.close());
    const replacements = await Promise.all([
      Effect.runPromise(workspace.open(project, persisted)),
      Effect.runPromise(workspace.open(project, persisted)),
    ]);
    const replacement = replacements[0];
    assert.notEqual(replacement.key, workspace.initialKey);
    assert.ok(replacements.every((snapshot) => snapshot.key === replacement.key));
    const freshOwner = await Effect.runPromise(workspace.session(replacement.key));
    const freshSettled = Promise.withResolvers<undefined>();
    freshOwner.subscribe((snapshot) => {
      if (
        snapshot.execution === "idle" &&
        snapshot.messages.some((message) =>
          JSON.stringify(message.content).includes("Freshly reopened owner"),
        )
      )
        freshSettled.resolve(undefined);
    });
    assert.equal(await Effect.runPromise(freshOwner.prompt("Freshly reopened owner")), "started");
    await freshSettled.promise;
    assert.deepEqual(credentials, [
      "Bearer account-a",
      "Bearer account-b",
      "Bearer account-a",
      "Bearer account-b",
    ]);
    await assert.rejects(
      Effect.runPromise(workspace.selectAccount("../invalid")),
      /available Pi account/u,
    );
  },
);
