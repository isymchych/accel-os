import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { DesktopSession } from "../../src/electron/session.ts";

const RequestSchema = Type.Object({
  tools: Type.Array(Type.Object({ function: Type.Object({ name: Type.String() }) })),
  messages: Type.Array(Type.Object({ role: Type.String(), content: Type.Unknown() })),
});

test(
  "configured Pi RPC entry reuses actual extensions with a local fake model and read tool",
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
    const server = createServer((request, response) => {
      void (async (): Promise<void> => {
        let body = "";
        for await (const chunk of request) {
          assert.ok(Buffer.isBuffer(chunk));
          body += chunk.toString("utf8");
        }
        const value: unknown = JSON.parse(body);
        assert.ok(Value.Check(RequestSchema, value));
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
        const toolCall = requests === 1;
        const delta = toolCall
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "fixture-read",
                  type: "function",
                  function: {
                    name: "read",
                    arguments: JSON.stringify({ targets: [{ path: "fixture.txt" }] }),
                  },
                },
              ],
            }
          : { role: "assistant", content: "Configured Pi completed the isolated read." };
        response.write(
          `data: ${JSON.stringify({
            id: `fixture-${requests}`,
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`,
        );
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
    const session = new DesktopSession({
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
    });
    t.after(async () => {
      await session.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await rm(directory, { recursive: true, force: true });
    });
    await session.start();
    const settled = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Configured Pi did not settle"));
      }, 15_000);
      const unsubscribe = session.subscribe((snapshot) => {
        if (
          snapshot.execution === "idle" &&
          snapshot.messages.some((message) => message.role === "assistant")
        ) {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
    await session.prompt("Read fixture.txt and report the result.");
    await settled;
    assert.equal(providerError, undefined);
    assert.equal(requests, 2);
    assert.ok(
      session
        .snapshot()
        .messages.some(
          (message) =>
            message.role === "toolResult" && message.text.includes("isolated tool result"),
        ),
    );
    assert.equal(
      session.snapshot().messages.at(-1)?.text,
      "Configured Pi completed the isolated read.",
    );
    assert.equal(await readFile(path.join(project, "fixture.txt"), "utf8"), "isolated tool result");
    const sessionFiles = await readdir(path.join(config, "sessions"), { recursive: true });
    assert.ok(sessionFiles.some((file) => file.endsWith(".jsonl")));
  },
);
