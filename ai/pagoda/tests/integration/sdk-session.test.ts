import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { Effect, Exit, Scope } from "effect";

import { createPiSession } from "../../src/backend/pi/session.ts";
import { DesktopSession } from "../../src/backend/session.ts";

test("SDK owners load shared resources and preserve per-owner cwd and session storage", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-"));
  const scope = Scope.makeUnsafe();
  t.after(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await rm(root, { recursive: true, force: true });
  });
  const shared = path.join(root, "ai");
  const agent = path.join(shared, "pi");
  const profile = path.join(root, "profile");
  const otherProfile = path.join(root, "other-profile");
  const project = path.join(root, "project");
  const storage = path.join(root, "sessions");
  await Promise.all([
    mkdir(path.join(shared, "skills", "fixture"), { recursive: true }),
    mkdir(path.join(shared, "prompts"), { recursive: true }),
    mkdir(agent, { recursive: true }),
    mkdir(profile),
    mkdir(otherProfile),
    mkdir(project),
  ]);
  await Promise.all([
    writeFile(path.join(shared, "SYSTEM.md"), "Shared system fixture"),
    writeFile(path.join(shared, "prompts", "fixture.md"), "Shared prompt fixture"),
    writeFile(
      path.join(shared, "skills", "fixture", "SKILL.md"),
      "---\nname: fixture\ndescription: Fixture skill\n---\nFixture content\n",
    ),
    writeFile(path.join(project, "AGENTS.md"), "Project instruction fixture"),
    writeFile(
      path.join(profile, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "synthetic-first" } }),
    ),
    writeFile(
      path.join(otherProfile, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "synthetic-second" } }),
    ),
  ]);
  let session!: AgentSession;
  await Effect.runPromise(
    DesktopSession.make(
      {
        cwd: project,
        agentDir: agent,
        profileDir: profile,
        sessionDir: storage,
        sharedDir: shared,
      },
      async (options) => {
        session = await createPiSession(options);
        return session;
      },
    ).pipe(Scope.provide(scope)),
  );
  let otherSession!: AgentSession;
  await Effect.runPromise(
    DesktopSession.make(
      {
        cwd: project,
        agentDir: agent,
        profileDir: otherProfile,
        sessionDir: storage,
        sharedDir: shared,
      },
      async (options) => {
        otherSession = await createPiSession(options);
        return otherSession;
      },
    ).pipe(Scope.provide(scope)),
  );
  assert.equal(session.sessionManager.getCwd(), project);
  assert.equal(session.sessionManager.getSessionDir(), storage);
  assert.ok(session.resourceLoader.getSkills().skills.some((skill) => skill.name === "fixture"));
  assert.ok(
    session.resourceLoader.getPrompts().prompts.some((prompt) => prompt.name === "fixture"),
  );
  assert.ok(session.systemPrompt.includes("Shared system fixture"));
  assert.ok(session.systemPrompt.includes("Project instruction fixture"));
  assert.deepEqual(session.resourceLoader.getExtensions().extensions, []);
  assert.equal((await session.modelRuntime.getAuth("anthropic"))?.auth.apiKey, "synthetic-first");
  assert.equal(
    (await otherSession.modelRuntime.getAuth("anthropic"))?.auth.apiKey,
    "synthetic-second",
  );
});

test(
  "closing an SDK owner scope cancels actual active provider work",
  { timeout: 15_000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-close-"));
    const shared = path.join(root, "ai");
    const agent = path.join(shared, "pi");
    const profile = path.join(root, "profile");
    const project = path.join(root, "project");
    await Promise.all([
      mkdir(path.join(shared, "skills"), { recursive: true }),
      mkdir(path.join(shared, "prompts"), { recursive: true }),
      mkdir(agent, { recursive: true }),
      mkdir(profile),
      mkdir(project),
    ]);
    await writeFile(path.join(shared, "SYSTEM.md"), "Synthetic fixture");
    await writeFile(path.join(profile, "auth.json"), "{}");
    const requested = Promise.withResolvers<undefined>();
    const disconnected = Promise.withResolvers<undefined>();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.flushHeaders();
      response.once("close", () => {
        disconnected.resolve(undefined);
      });
      requested.resolve(undefined);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const scope = Scope.makeUnsafe();
    t.after(async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(root, { recursive: true, force: true });
    });
    await writeFile(
      path.join(agent, "models.json"),
      JSON.stringify({
        providers: {
          "sdk-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "synthetic-test-key",
            models: [{ id: "fixture", contextWindow: 128_000, maxTokens: 1_000 }],
          },
        },
      }),
    );
    let session!: AgentSession;
    const owner = await Effect.runPromise(
      DesktopSession.make(
        {
          cwd: project,
          agentDir: agent,
          profileDir: profile,
          sessionDir: path.join(root, "sessions"),
          sharedDir: shared,
        },
        async (options) => {
          session = await createPiSession(options);
          return session;
        },
      ).pipe(Scope.provide(scope)),
    );
    await Effect.runPromise(owner.model("sdk-fixture", "fixture"));
    const accepted = await Effect.runPromise(owner.prompt("Hold this response."));
    assert.equal(accepted, "started");
    await requested.promise;
    assert.equal(session.isStreaming, true);
    assert.equal(await Effect.runPromise(owner.prompt("Queued input", "follow_up")), "queued");
    await assert.rejects(session.prompt("Not queued"), /already processing/u);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await disconnected.promise;
    assert.equal(session.isIdle, true);
    assert.equal(owner.snapshot().error, null);
    const file = session.sessionFile;
    assert.ok(file);
    assert.match(await readFile(file, "utf8"), /Hold this response/u);
  },
);

test(
  "closing an SDK owner scope terminates an active bash tool",
  { timeout: 15_000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-tool-"));
    const shared = path.join(root, "ai");
    const agent = path.join(shared, "pi");
    const profile = path.join(root, "profile");
    const project = path.join(root, "project");
    await Promise.all([
      mkdir(path.join(shared, "skills"), { recursive: true }),
      mkdir(path.join(shared, "prompts"), { recursive: true }),
      mkdir(agent, { recursive: true }),
      mkdir(profile),
      mkdir(project),
    ]);
    await Promise.all([
      writeFile(path.join(shared, "SYSTEM.md"), "Synthetic fixture"),
      writeFile(path.join(profile, "auth.json"), "{}"),
    ]);
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finishReason] of [
        [
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "fixture-bash",
                type: "function",
                function: {
                  name: "bash",
                  arguments: JSON.stringify({
                    command: "printf '%s' \"$$\" > tool-pid; printf 'TOOL_READY\\n'; exec sleep 60",
                  }),
                },
              },
            ],
          },
          null,
        ],
        [{}, "tool_calls"],
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
    const scope = Scope.makeUnsafe();
    t.after(async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(root, { recursive: true, force: true });
    });
    await writeFile(
      path.join(agent, "models.json"),
      JSON.stringify({
        providers: {
          "sdk-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "synthetic-test-key",
            models: [{ id: "fixture", contextWindow: 128_000, maxTokens: 1_000 }],
          },
        },
      }),
    );
    let session!: AgentSession;
    const owner = await Effect.runPromise(
      DesktopSession.make(
        {
          cwd: project,
          agentDir: agent,
          profileDir: profile,
          sessionDir: path.join(root, "sessions"),
          sharedDir: shared,
        },
        async (options) => {
          session = await createPiSession(options);
          return session;
        },
      ).pipe(Scope.provide(scope)),
    );
    await Effect.runPromise(owner.model("sdk-fixture", "fixture"));
    const ready = Promise.withResolvers<undefined>();
    session.subscribe((event) => {
      if (
        event.type === "tool_execution_update" &&
        JSON.stringify(event.partialResult).includes("TOOL_READY")
      ) {
        ready.resolve(undefined);
      }
    });
    assert.equal(await Effect.runPromise(owner.prompt("Run the tool")), "started");
    await ready.promise;
    const pid = Number(await readFile(path.join(project, "tool-pid"), "utf8"));
    process.kill(pid, 0);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.equal(session.isIdle, true);
    assert.equal(owner.snapshot().error, null);
  },
);
