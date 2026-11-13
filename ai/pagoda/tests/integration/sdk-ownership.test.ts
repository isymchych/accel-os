import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { Effect, Exit, Fiber, Scope } from "effect";

import { DesktopSession } from "../../src/backend/session.ts";
import { DesktopWorkspace } from "../../src/backend/workspace.ts";
import {
  fakePiOptions,
  fakeSessionFactory,
  metadataStore,
  runScoped,
  setupFakePi,
} from "./fixtures/helpers.ts";

test("shutdown during SDK acquisition waits for and releases the acquired owner", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-acquisition-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  t.after(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const acquiring = Promise.withResolvers<undefined>();
  const acquired = Promise.withResolvers<undefined>();
  const starting = assert.rejects(
    Effect.runPromise(
      DesktopSession.make(fakePiOptions(root), async (options) => {
        acquiring.resolve(undefined);
        await acquired.promise;
        return fakeSessionFactory(options);
      }).pipe(Scope.provide(scope)),
    ),
  );
  await acquiring.promise;
  let closed = false;
  const closing = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => {
    closed = true;
  });
  assert.equal(closed, false);
  acquired.resolve(undefined);
  await Promise.all([starting, closing]);
  assert.equal(await readFile(path.join(root, "closed"), "utf8"), "clean");
});

test("acquisition and binding failures release SDK resources and reject session creation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-failure-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    runScoped(
      t,
      DesktopSession.make(fakePiOptions(root), async () => {
        throw new Error("acquire failed");
      }),
    ),
    /acquire failed/u,
  );
  await assert.rejects(
    runScoped(
      t,
      DesktopSession.make(fakePiOptions(root), async (options) => {
        const sdk = await fakeSessionFactory(options);
        sdk.bindExtensions = async (): Promise<void> => {
          throw new Error("bind failed");
        };
        return sdk;
      }),
    ),
    /bind failed/u,
  );
  assert.equal(await readFile(path.join(root, "closed"), "utf8"), "clean");
});

test("shutdown waits for SDK binding before aborting and disposing the session", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-binding-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  t.after(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const binding = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const lifecycle: string[] = [];
  const starting = assert.rejects(
    Effect.runPromise(
      DesktopSession.make(fakePiOptions(root), async (options) => {
        const sdk = await fakeSessionFactory(options);
        const bind = sdk.bindExtensions.bind(sdk);
        const abort = sdk.abort.bind(sdk);
        const dispose = sdk.dispose.bind(sdk);
        sdk.bindExtensions = async (bindings): Promise<void> => {
          binding.resolve(undefined);
          await release.promise;
          await bind(bindings);
          lifecycle.push("bound");
        };
        sdk.abort = async (): Promise<void> => {
          lifecycle.push("abort");
          await abort();
        };
        sdk.dispose = (): void => {
          lifecycle.push("dispose");
          dispose();
        };
        return sdk;
      }).pipe(Scope.provide(scope)),
    ),
  );
  await binding.promise;
  const closing = Effect.runPromise(Scope.close(scope, Exit.void));
  release.resolve(undefined);
  await Promise.all([starting, closing]);
  assert.deepEqual(lifecycle, ["bound", "abort", "dispose"]);
});

test("parent shutdown and explicit close share the same in-flight cleanup", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-shared-close-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const scope = Scope.makeUnsafe();
  const aborting = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const lifecycle: string[] = [];
  const session = await Effect.runPromise(
    DesktopSession.make(fakePiOptions(root), async (options) => {
      const sdk = await fakeSessionFactory(options);
      const abort = sdk.abort.bind(sdk);
      const dispose = sdk.dispose.bind(sdk);
      sdk.abort = async (): Promise<void> => {
        lifecycle.push("abort");
        aborting.resolve(undefined);
        await release.promise;
        await abort();
      };
      sdk.dispose = (): void => {
        lifecycle.push("dispose");
        dispose();
      };
      return sdk;
    }).pipe(Scope.provide(scope)),
  );
  t.after(() => {
    release.resolve(undefined);
    return Effect.runPromise(Scope.close(scope, Exit.void));
  });
  let parentDone = false;
  let explicitDone = false;
  const parent = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => {
    parentDone = true;
  });
  await aborting.promise;
  const explicit = Effect.runPromise(session.close()).then(() => {
    explicitDone = true;
  });
  await setImmediate();
  assert.equal(parentDone, false);
  assert.equal(explicitDone, false);
  release.resolve(undefined);
  await Promise.all([parent, explicit]);
  assert.deepEqual(lifecycle, ["abort", "dispose"]);
});

test("workspace shutdown waits for an in-flight SDK mutation before disposal", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-mutation-"));
  await setupFakePi(root);
  t.after(async () => rm(root, { recursive: true, force: true }));
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const aborted = Promise.withResolvers<undefined>();
  const lifecycle: string[] = [];
  const workspace = await runScoped(
    t,
    DesktopWorkspace.make(
      fakePiOptions(root),
      await metadataStore(fakePiOptions(root).agentDir),
      48,
      async (options) => {
        const sdk = await fakeSessionFactory(options);
        const abort = sdk.abort.bind(sdk);
        const dispose = sdk.dispose.bind(sdk);
        const settle = sdk.modelRuntime.settleCredentialWrites.bind(sdk.modelRuntime);
        sdk.setModel = async (): Promise<void> => {
          started.resolve(undefined);
          await release.promise;
          lifecycle.push("mutation finished");
        };
        sdk.abort = async (): Promise<void> => {
          lifecycle.push("abort");
          await abort();
          aborted.resolve(undefined);
        };
        sdk.dispose = (): void => {
          lifecycle.push("dispose");
          dispose();
        };
        sdk.modelRuntime.settleCredentialWrites = async (): Promise<void> => {
          lifecycle.push("credentials settled");
          await settle();
        };
        return sdk;
      },
    ),
  );
  const command = Effect.runPromiseExit(
    workspace.command(
      workspace
        .session(workspace.initialKey)
        .pipe(Effect.flatMap((session) => session.model("fake", "fixture"))),
    ),
  );
  await started.promise;
  const closing = Effect.runPromise(workspace.close());
  await aborted.promise;
  await setImmediate();
  const beforeRelease = [...lifecycle];
  release.resolve(undefined);
  await Promise.all([closing, command]);
  assert.ok(!beforeRelease.includes("dispose"), "SDK disposal must wait for the mutation");
  assert.deepEqual(lifecycle, ["abort", "mutation finished", "dispose", "credentials settled"]);
});

test("shutdown aborts accepted work before waiting for its SDK prompt to settle", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-prompt-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const aborted = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const lifecycle: string[] = [];
  const session = await runScoped(
    t,
    DesktopSession.make(fakePiOptions(root), async (options) => {
      const sdk = await fakeSessionFactory(options);
      const abort = sdk.abort.bind(sdk);
      const dispose = sdk.dispose.bind(sdk);
      sdk.prompt = async (_text, promptOptions): Promise<void> => {
        promptOptions?.preflightResult?.("started");
        await release.promise;
        lifecycle.push("prompt finished");
      };
      sdk.abort = async (): Promise<void> => {
        lifecycle.push("abort");
        await abort();
        aborted.resolve(undefined);
      };
      sdk.dispose = (): void => {
        lifecycle.push("dispose");
        dispose();
      };
      return sdk;
    }),
  );
  assert.equal(await Effect.runPromise(session.prompt("work")), "started");
  const closing = Effect.runPromise(session.close());
  await aborted.promise;
  await setImmediate();
  const beforeRelease = [...lifecycle];
  release.resolve(undefined);
  await closing;
  assert.deepEqual(beforeRelease, ["abort"]);
  assert.deepEqual(lifecycle, ["abort", "prompt finished", "dispose"]);
});

test("shutdown waits for prompt preflight before aborting the resulting run", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-preflight-"));
  const preflight = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const cancelled = Promise.withResolvers<undefined>();
  const lifecycle: string[] = [];
  t.after(() => {
    release.resolve(undefined);
    cancelled.resolve(undefined);
  });
  const session = await runScoped(
    t,
    DesktopSession.make(fakePiOptions(root), async (options) => {
      const sdk = await fakeSessionFactory(options);
      const abort = sdk.abort.bind(sdk);
      const dispose = sdk.dispose.bind(sdk);
      sdk.prompt = async (_text, promptOptions): Promise<void> => {
        preflight.resolve(undefined);
        await release.promise;
        lifecycle.push("started");
        promptOptions?.preflightResult?.("started");
        await cancelled.promise;
        lifecycle.push("settled");
      };
      sdk.abort = async (): Promise<void> => {
        lifecycle.push("abort");
        cancelled.resolve(undefined);
        await abort();
      };
      sdk.dispose = (): void => {
        lifecycle.push("dispose");
        dispose();
      };
      return sdk;
    }),
  );
  t.after(async () => rm(root, { recursive: true, force: true }));
  const command = Effect.runPromiseExit(session.prompt("work"));
  await preflight.promise;
  const closing = Effect.runPromise(session.close());
  await setImmediate();
  const beforeRelease = [...lifecycle];
  release.resolve(undefined);
  await Promise.all([closing, command]);
  assert.deepEqual(beforeRelease, []);
  assert.deepEqual(lifecycle, ["started", "abort", "settled", "dispose"]);
});

test("cancelling a caller leaves its SDK mutation owned and busy until settlement", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-waiter-"));
  const started = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  t.after(() => {
    release.resolve(undefined);
  });
  const session = await runScoped(
    t,
    DesktopSession.make(fakePiOptions(root), async (options) => {
      const sdk = await fakeSessionFactory(options);
      sdk.setModel = async (): Promise<void> => {
        started.resolve(undefined);
        await release.promise;
      };
      return sdk;
    }),
  );
  t.after(async () => {
    release.resolve(undefined);
    await Effect.runPromise(session.close());
    await rm(root, { recursive: true, force: true });
  });
  const caller = Effect.runFork(session.model("fake", "fixture"));
  await started.promise;
  await Effect.runPromise(Fiber.interrupt(caller));
  await assert.rejects(Effect.runPromise(session.thinking("off")), /connected and idle/u);
  release.resolve(undefined);
  await setImmediate();
  await Effect.runPromise(session.thinking("off"));
  assert.equal(session.snapshot().connection, "connected");
});

test("execution errors after acceptance remain visible without changing acceptance", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pagoda-sdk-execution-error-"));
  const release = Promise.withResolvers<undefined>();
  t.after(() => {
    release.resolve(undefined);
  });
  const session = await runScoped(
    t,
    DesktopSession.make(fakePiOptions(root), async (options) => {
      const sdk = await fakeSessionFactory(options);
      sdk.prompt = async (_text, promptOptions): Promise<void> => {
        promptOptions?.preflightResult?.("started");
        await release.promise;
        throw new Error("Execution failed after acceptance");
      };
      return sdk;
    }),
  );
  t.after(async () => {
    release.resolve(undefined);
    await Effect.runPromise(session.close());
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(await Effect.runPromise(session.prompt("work")), "started");
  const reported = Promise.withResolvers<undefined>();
  session.subscribe((snapshot) => {
    if (snapshot.error === "Execution failed after acceptance") reported.resolve(undefined);
  });
  release.resolve(undefined);
  await reported.promise;
  assert.equal(session.snapshot().connection, "connected");
});
