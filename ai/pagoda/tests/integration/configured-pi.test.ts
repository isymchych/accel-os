import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Schema } from "effect";

import { DesktopSession } from "../../src/backend/session.ts";
import type { SessionSnapshot } from "../../src/contracts/index.ts";
import { contentText, waitForSession } from "./fixtures/helpers.ts";

const RequestSchema = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) })),
  messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
});
const PersistedMessageSchema = Schema.Struct({
  type: Schema.Literal("message"),
  message: Schema.Struct({ role: Schema.String, content: Schema.Unknown }),
});

const observe = (
  session: DesktopSession,
  predicate: Parameters<typeof waitForSession>[1],
): Promise<SessionSnapshot> =>
  waitForSession(session, predicate, {
    timeout: 15_000,
    description: "Configured Pi state was not observed",
  });

test(
  "configured Pi compatibility with isolated native sessions and a local fake provider",
  { timeout: 30_000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "configured-pi-ui-"));
    const config = path.join(directory, "ai/pi");
    const profile = path.join(directory, "profile");
    const project = path.join(directory, "project");
    await Promise.all([mkdir(config, { recursive: true }), mkdir(profile), mkdir(project)]);
    await symlink(
      path.resolve(import.meta.dirname, "../../../pi/extensions"),
      path.join(config, "extensions"),
    );
    await writeFile(
      path.join(directory, "ai/SYSTEM.md"),
      "SYSTEM_FIXTURE: use only harmless fixture tools.",
    );
    await writeFile(path.join(project, "fixture.txt"), "isolated tool result");
    await writeFile(path.join(profile, "auth.json"), "{}");
    await writeFile(
      path.join(profile, "settings.json"),
      JSON.stringify({
        defaultProvider: "desktop-fixture",
        defaultModel: "fixture",
        defaultTools: ["read", "bash", "apply_patch", "codemode"],
        retry: { enabled: false },
        enableInstallTelemetry: false,
      }),
    );

    let requests = 0;
    let providerError: unknown;
    const queueStarted = Promise.withResolvers<undefined>();
    const releaseQueue = Promise.withResolvers<undefined>();
    const queueInputs: string[] = [];
    const server = createServer((request, response) => {
      void (async (): Promise<void> => {
        let body = "";
        for await (const chunk of request) {
          assert.ok(Buffer.isBuffer(chunk));
          body += chunk.toString("utf8");
        }
        const value: unknown = JSON.parse(body);
        assert.ok(Schema.is(RequestSchema)(value));
        const names = value.tools.map((tool) => tool.function.name);
        assert.ok(names.includes("read"));
        assert.ok(names.includes("apply_patch"));
        assert.ok(names.includes("codemode"));
        assert.ok(!names.includes("write"));
        assert.ok(!names.includes("grep"));
        assert.ok(JSON.stringify(value.messages).includes("SYSTEM_FIXTURE"));
        assert.equal(request.headers.authorization, "Bearer synthetic-test-key");
        requests += 1;
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        const lastUser = value.messages.findLast((message) => message.role === "user");
        const input = lastUser ? JSON.stringify(lastUser.content) : "";
        const queueInput = ["QUEUE_RUN", "QUEUE_STEER", "QUEUE_FOLLOW"].find((label) =>
          input.includes(label),
        );
        if (queueInput) queueInputs.push(queueInput);
        const hold = input.includes("HOLD_SOURCE");
        const shell = input.includes("RUN_HARMLESS_TOOL");
        const toolCall = requests === 1 || shell;
        const delta = toolCall
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: shell ? "fixture-bash" : "fixture-read",
                  type: "function",
                  function: {
                    name: shell ? "bash" : "read",
                    arguments: JSON.stringify(
                      shell
                        ? {
                            command:
                              "printf '%s' \"$$\" > native-tool-pid; printf 'NATIVE_WAIT_READY\\n'; exec sleep 60",
                          }
                        : { targets: [{ path: "fixture.txt" }] },
                    ),
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content: queueInput
                ? `Queue response ${queueInputs.length}`
                : "Configured Pi completed the isolated read.",
            };
        response.write(
          `data: ${JSON.stringify({
            id: `fixture-${requests}`,
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`,
        );
        if (hold) return;
        if (queueInput === "QUEUE_RUN") {
          queueStarted.resolve(undefined);
          await releaseQueue.promise;
        }
        response.write(
          `data: ${JSON.stringify({
            id: `fixture-${requests}`,
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }],
          })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
      })().catch((error: unknown) => {
        providerError = error;
        response.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    await writeFile(
      path.join(profile, "models.json"),
      JSON.stringify({
        providers: {
          "desktop-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: "synthetic-test-key",
            models: [{ id: "fixture", contextWindow: 128_000, maxTokens: 1000 }],
          },
        },
      }),
    );
    const launch = {
      executable: process.execPath,
      args: [
        path.resolve(import.meta.dirname, "../../../pi/runtime/rpc-entry.ts"),
        "--profile-dir",
        profile,
      ],
      cwd: project,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: directory,
        XDG_RUNTIME_DIR: directory,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
        ACCEL_OS: directory,
        PI_OFFLINE: "1",
      },
    };
    const session = new DesktopSession(launch);
    let destination: DesktopSession | undefined;
    t.after(async () => {
      releaseQueue.resolve(undefined);
      await session.close();
      await destination?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(directory, { recursive: true, force: true });
    });
    await session.start();
    await t.test("canonical configuration executes the actual read tool", async () => {
      const settled = observe(
        session,
        (snapshot) =>
          snapshot.execution === "idle" &&
          snapshot.messages.some((message) => message.role === "assistant"),
      );
      await session.prompt("Read fixture.txt and report the result.");
      await settled;
      assert.equal(providerError, undefined);
      assert.equal(requests, 2);
      assert.ok(
        session
          .snapshot()
          .messages.some(
            (message) =>
              message.role === "toolResult" &&
              contentText(message.content).includes("isolated tool result"),
          ),
      );
      assert.equal(
        contentText(session.snapshot().messages.at(-1)?.content),
        "Configured Pi completed the isolated read.",
      );
      assert.equal(
        await readFile(path.join(project, "fixture.txt"), "utf8"),
        "isolated tool result",
      );
    });
    const catalog = await session.list(project);
    assert.equal(catalog.length, 1);
    const original = catalog[0];
    assert.ok(original);
    assert.ok((await session.listAll()).some((item) => item.id === original.id));
    const history = await session.history();
    const first = history.entries.find((entry) => entry.label.startsWith("user:"));
    assert.ok(first && history.leafId);
    const leafId = history.leafId;
    await t.test("current user leaf navigation is a no-op without restored text", async () => {
      const forkPath = await session.fork(first.id);
      const fork = new DesktopSession({ ...launch, args: [...launch.args, "--session", forkPath] });
      try {
        await fork.start();
        const before = fork.snapshot().messages;
        assert.equal((await fork.history()).leafId, first.id);
        assert.equal(await fork.navigate(first.id), undefined);
        assert.equal((await fork.history()).leafId, first.id);
        assert.deepEqual(fork.snapshot().messages, before);
      } finally {
        await fork.close();
        await rm(forkPath, { force: true });
      }
    });
    await t.test(
      "native navigation preserves entries and model controls omit credentials",
      async () => {
        assert.equal(await session.navigate(first.id), "Read fixture.txt and report the result.");
        assert.equal(session.snapshot().messages.length, 1);
        await session.navigate(leafId);
        assert.deepEqual(
          (await session.history()).entries,
          history.entries,
          "Navigation preserves every original entry",
        );
        const controls = await session.controls();
        assert.deepEqual(controls.model, { provider: "desktop-fixture", id: "fixture" });
        assert.ok(!JSON.stringify(controls).includes("synthetic-test-key"));
        await session.model("desktop-fixture", "fixture");
        await session.thinking("off");
      },
    );

    await t.test(
      "snapshot execution leaves the streaming source and its persisted history untouched",
      async () => {
        const active = observe(session, (snapshot) => snapshot.streaming.length > 0);
        await session.prompt("HOLD_SOURCE");
        await active;
        const sourceBytes = await readFile(original.path, "utf8");
        const forkPath = await session.fork(leafId);
        assert.equal(await readFile(original.path, "utf8"), sourceBytes);
        assert.equal(session.snapshot().execution, "running");
        await assert.rejects(session.navigate(first.id), /idle/u);
        destination = new DesktopSession({
          ...launch,
          args: [...launch.args, "--session", forkPath],
        });
        await destination.start();
        assert.notEqual(destination.snapshot().sessionId, session.snapshot().sessionId);
        assert.ok(
          !destination
            .snapshot()
            .messages.some((message) => contentText(message.content).includes("HOLD_SOURCE")),
        );
        const forkSettled = observe(
          destination,
          (snapshot) =>
            snapshot.execution === "idle" &&
            snapshot.messages.some((message) =>
              contentText(message.content).includes("Independent fork"),
            ),
        );
        await destination.prompt("Independent fork");
        await forkSettled;
        assert.equal(
          session.snapshot().execution,
          "running",
          "Destination execution does not retarget the source",
        );
        await session.stop();
      },
    );
    await t.test("Stop terminates an actual configured shell process", async () => {
      const toolRunning = observe(session, (snapshot) =>
        snapshot.tools.some(
          (tool) => tool.name === "bash" && contentText(tool.content).includes("NATIVE_WAIT_READY"),
        ),
      );
      await session.prompt("RUN_HARMLESS_TOOL");
      await toolRunning;
      const nativeToolPid = Number(await readFile(path.join(project, "native-tool-pid"), "utf8"));
      process.kill(nativeToolPid, 0);
      await session.stop();
      assert.throws(() => process.kill(nativeToolPid, 0), { code: "ESRCH" });
      assert.equal(providerError, undefined);
      assert.equal(requests, 5);
    });
    await t.test(
      "idle follow-ups and steering start execution without another prompt",
      async () => {
        for (const mode of ["follow_up", "steer"] as const) {
          const text = `Idle ${mode}`;
          const messages = session.snapshot().messages.length;
          const complete = observe(
            session,
            (snapshot) =>
              snapshot.execution === "idle" &&
              snapshot.messages.length > messages &&
              snapshot.messages.at(-1)?.role === "assistant" &&
              snapshot.messages.some((message) => contentText(message.content) === text),
          );
          assert.equal(await session.prompt(text, mode), "started");
          await complete;
          assert.equal((await session.controls()).pendingMessageCount, 0);
        }
      },
    );
    await t.test(
      "native steering runs before follow-up without interrupting the current response",
      async () => {
        await session.prompt("QUEUE_RUN");
        await queueStarted.promise;
        assert.equal(await session.prompt("QUEUE_FOLLOW", "follow_up"), "queued");
        assert.equal(await session.prompt("QUEUE_STEER", "steer"), "queued");
        assert.deepEqual(
          queueInputs,
          ["QUEUE_RUN"],
          "Queued inputs must not launch another provider request while the response is held",
        );
        assert.equal((await session.controls()).pendingMessageCount, 2);
        const complete = observe(
          session,
          (snapshot) =>
            snapshot.execution === "idle" &&
            snapshot.messages.some(
              (message) => contentText(message.content) === "Queue response 3",
            ),
        );
        releaseQueue.resolve(undefined);
        await complete;
        assert.deepEqual(queueInputs, ["QUEUE_RUN", "QUEUE_STEER", "QUEUE_FOLLOW"]);
        assert.deepEqual(
          session
            .snapshot()
            .messages.filter(
              (message) =>
                message.role === "user" && contentText(message.content).startsWith("QUEUE_"),
            )
            .map((message) => contentText(message.content)),
          ["QUEUE_RUN", "QUEUE_STEER", "QUEUE_FOLLOW"],
        );
        assert.equal((await session.controls()).pendingMessageCount, 0);
        assert.equal(providerError, undefined);
      },
    );
    await session.close();
    await t.test("native persistence retains the original session after shutdown", async () => {
      const sessionsDirectory = path.join(config, "sessions");
      const sessionFiles = (await readdir(sessionsDirectory, { recursive: true })).filter((file) =>
        file.endsWith(".jsonl"),
      );
      assert.equal(sessionFiles.length, 2);
      const entries = await readFile(original.path, "utf8");
      const messages = entries
        .trim()
        .split("\n")
        .flatMap((line) => {
          const entry: unknown = JSON.parse(line);
          return Schema.is(PersistedMessageSchema)(entry) ? [entry.message] : [];
        });
      assert.deepEqual(messages.find((message) => message.role === "user")?.content, [
        { type: "text", text: "Read fixture.txt and report the result." },
      ]);
      assert.ok(
        messages.some(
          (message) =>
            message.role === "toolResult" &&
            JSON.stringify(message.content).includes("isolated tool result"),
        ),
      );
      assert.ok(
        messages.some(
          (message) =>
            message.role === "assistant" &&
            JSON.stringify(message.content).includes("Configured Pi completed the isolated read."),
        ),
      );
    });
  },
);
