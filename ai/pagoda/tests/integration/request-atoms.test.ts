import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Effect, Layer, Schema as S } from "effect";
import { FetchHttpClient } from "effect/http";
import { AsyncResult, AtomRegistry } from "effect/reactivity";

import {
  MetadataFlagSchema,
  TargetSchema,
  type SessionControls,
} from "../../src/contracts/index.ts";
import { createComposerAtoms } from "../../src/renderer/session/composer-state.ts";
import { createSessionState, type SessionState } from "../../src/renderer/session/session-state.ts";
import {
  ClientFailure,
  errorMessage,
  requestFeedback,
} from "../../src/renderer/transport/errors.ts";
import {
  createHttpClient,
  runCommand,
  type PagodaClient,
} from "../../src/renderer/transport/http-client.ts";
import {
  createWorkspaceRequests,
  type WorkspaceRequests,
} from "../../src/renderer/workspace/requests.ts";

const ownerA = S.decodeUnknownSync(TargetSchema)({ key: "owner-a" }).key;
const ownerB = S.decodeUnknownSync(TargetSchema)({ key: "owner-b" }).key;
const stored = {
  id: "stored-session",
  path: "/sessions/stored.jsonl",
  cwd: "/project",
  name: "Stored work",
  modified: "2026-01-01T00:00:00.000Z",
};

function setup(
  t: TestContext,
  fetch: typeof globalThis.fetch,
): {
  registry: AtomRegistry.AtomRegistry;
  requests: WorkspaceRequests & SessionState;
  http: PagodaClient;
} {
  const registry = AtomRegistry.make();
  t.after(() => {
    registry.dispose();
  });
  const httpClient = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  const http = createHttpClient("http://127.0.0.1:4317", httpClient);
  return {
    registry,
    requests: { ...createWorkspaceRequests(http), ...createSessionState(http) },
    http,
  };
}

function controls(model: string): SessionControls {
  return {
    models: [{ provider: "fake", id: model, name: model }],
    model: { provider: "fake", id: model },
    thinkingLevel: "off",
    levels: ["off", "high"],
    pendingMessageCount: 0,
  };
}

test("composer submissions use the shared HTTP client", async (t) => {
  const received = Promise.withResolvers<undefined>();
  const response = Promise.withResolvers<Response>();
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, "/api/prompt");
    assert.deepEqual(await request.json(), { key: ownerA, message: "hello", mode: "prompt" });
    received.resolve(undefined);
    return response.promise;
  });
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  const composer = createComposerAtoms(storage, requests.prompt)(ownerA);
  registry.set(composer.edit, { message: "hello" });
  registry.set(composer.submit, "prompt");
  await received.promise;
  assert.equal(registry.get(composer.state).pending, true);
  const completed = new Promise<void>((resolve) => {
    const unsubscribe = registry.subscribe(composer.state, (state) => {
      if (!state.pending) {
        unsubscribe();
        resolve();
      }
    });
  });
  response.resolve(Response.json("started"));
  await completed;
  assert.equal(storage.getItem("pi-composer:owner-a"), "");
});

test("direct commands share the atom client and keep overlapping results correlated", async (t) => {
  const first = Promise.withResolvers<Response>();
  const requested = Promise.withResolvers<undefined>();
  const { registry, http } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, "/api/directory");
    const payload = (await request.json()) as { cwd: string };
    if (payload.cwd === "/first") {
      requested.resolve(undefined);
      return first.promise;
    }
    return Response.json("/second");
  });
  const directory = (cwd: string): Promise<string> =>
    runCommand(
      registry,
      http.request((client) => client.workspace.directory({ payload: { cwd } })),
    );
  const a = directory("/first");
  await requested.promise;
  assert.equal(await directory("/second"), "/second");
  first.resolve(Response.json("/first"));
  assert.equal(await a, "/first");
});

test("transport and invalid-response failures retain their meaning until read or command presentation", async (t) => {
  const { registry, requests, http } = setup(t, () => {
    throw new TypeError("Connection lost");
  });
  registry.mount(requests.catalog);
  await assert.rejects(Effect.runPromise(AtomRegistry.getResult(registry, requests.catalog)));
  assert.equal(
    requestFeedback(registry.get(requests.catalog)),
    "Backend connection lost. Could not load data.",
  );
  await assert.rejects(
    runCommand(
      registry,
      http.request((client) => client.workspace.create({ payload: { cwd: "/project" } })),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ClientFailure);
      assert.equal(error.kind, "transport");
      assert.match(errorMessage(error), /outcome is uncertain/u);
      return true;
    },
  );
  const invalid = setup(t, () => Promise.resolve(Response.json({ unexpected: true })));
  invalid.registry.mount(invalid.requests.catalog);
  await assert.rejects(
    Effect.runPromise(AtomRegistry.getResult(invalid.registry, invalid.requests.catalog)),
  );
  assert.equal(
    requestFeedback(invalid.registry.get(invalid.requests.catalog)),
    "Invalid backend response.",
  );
});

test("stop remains pending for its owner across view switches without retrying", async (t) => {
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<Response>();
  let calls = 0;
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, "/api/stop");
    assert.deepEqual(await request.json(), { key: ownerA });
    calls += 1;
    requested.resolve(undefined);
    return release.promise;
  });
  const a = requests.stop(ownerA);
  const b = requests.stop(ownerB);
  const unmount = registry.mount(a);
  registry.set(a, undefined);
  await requested.promise;
  unmount();
  assert.equal(registry.get(a).waiting, true);
  assert.equal(registry.get(b).waiting, false);
  release.resolve(Response.json({ error: "Stop failed" }, { status: 500 }));
  await assert.rejects(
    Effect.runPromise(AtomRegistry.getResult(registry, a, { suspendOnWaiting: true })),
    /Stop failed/u,
  );
  assert.equal(requestFeedback(registry.get(a)), "Stop failed");
  assert.equal(calls, 1);
});

test("metadata mutations are isolated by session and flag", async (t) => {
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<Response>();
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, "/api/metadata-flag");
    assert.deepEqual(await request.json(), { id: "stored-session", flag: "pinned", value: true });
    requested.resolve(undefined);
    return release.promise;
  });
  const id = S.decodeUnknownSync(MetadataFlagSchema)({
    id: "stored-session",
    flag: "pinned",
    value: true,
  }).id;
  const pin = requests.metadata(id, "pinned");
  const favourite = requests.metadata(id, "favourite");
  registry.set(pin, true);
  await requested.promise;
  assert.equal(registry.get(pin).waiting, true);
  assert.equal(registry.get(favourite).waiting, false);
  release.resolve(Response.json(null));
  await Effect.runPromise(AtomRegistry.getResult(registry, pin, { suspendOnWaiting: true }));
});

test("catalog refresh ignores an older response even when the transport ignores cancellation", async (t) => {
  const requested = Promise.withResolvers<undefined>();
  const stale = Promise.withResolvers<Response>();
  let calls = 0;
  const { registry, requests } = setup(t, async () => {
    calls += 1;
    if (calls === 2) {
      requested.resolve(undefined);
      return stale.promise;
    }
    return Response.json(calls === 1 ? [] : [stored]);
  });
  registry.mount(requests.catalog);
  assert.deepEqual(await Effect.runPromise(AtomRegistry.getResult(registry, requests.catalog)), []);
  registry.refresh(requests.catalog);
  await requested.promise;
  registry.refresh(requests.catalog);
  assert.deepEqual(
    await Effect.runPromise(
      AtomRegistry.getResult(registry, requests.catalog, { suspendOnWaiting: true }),
    ),
    [stored],
  );
  stale.resolve(Response.json([{ ...stored, name: "Stale work" }]));
  // Drain the released fetch's continuations before inspecting the retained result.
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.deepEqual(AsyncResult.getOrThrow(registry.get(requests.catalog)), [stored]);
  assert.equal(calls, 3);
});

test("a failed catalog refresh retains data and reports the error until an explicit retry", async (t) => {
  let calls = 0;
  const { registry, requests } = setup(t, async () => {
    calls += 1;
    return calls === 2
      ? Response.json({ error: "Catalog unavailable" }, { status: 500 })
      : Response.json([stored]);
  });
  registry.mount(requests.catalog);
  await Effect.runPromise(AtomRegistry.getResult(registry, requests.catalog));
  registry.refresh(requests.catalog);
  await assert.rejects(
    Effect.runPromise(
      AtomRegistry.getResult(registry, requests.catalog, { suspendOnWaiting: true }),
    ),
    /Catalog unavailable/u,
  );
  assert.equal(requestFeedback(registry.get(requests.catalog)), "Catalog unavailable");
  assert.deepEqual(AsyncResult.getOrThrow(registry.get(requests.catalog)), [stored]);
  assert.equal(calls, 2, "A failure must not retry itself");
  registry.refresh(requests.catalog);
  await Effect.runPromise(
    AtomRegistry.getResult(registry, requests.catalog, { suspendOnWaiting: true }),
  );
  assert.equal(requestFeedback(registry.get(requests.catalog)), null);
});

test("a late controls response stays with its owner", async (t) => {
  const requested = Promise.withResolvers<undefined>();
  const first = Promise.withResolvers<Response>();
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    const payload: unknown = await request.json();
    const { key } = S.decodeUnknownSync(TargetSchema)(payload);
    if (key === ownerA) {
      requested.resolve(undefined);
      return first.promise;
    }
    return Response.json(controls("second"));
  });
  const a = requests.controls(ownerA);
  const b = requests.controls(ownerB);
  registry.mount(a);
  await requested.promise;
  registry.mount(b);
  assert.equal((await Effect.runPromise(AtomRegistry.getResult(registry, b))).model?.id, "second");
  first.resolve(Response.json(controls("first")));
  assert.equal((await Effect.runPromise(AtomRegistry.getResult(registry, a))).model?.id, "first");
  assert.equal(AsyncResult.getOrThrow(registry.get(b)).model?.id, "second");
});

test("control mutations survive view switches and invalidate only the originating owner's query", async (t) => {
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let modelA = "first";
  let readsA = 0;
  let readsB = 0;
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    const payload: unknown = await request.json();
    const { key } = S.decodeUnknownSync(TargetSchema)(payload);
    if (new URL(request.url).pathname === "/api/model") {
      assert.equal(key, ownerA);
      assert.deepEqual(payload, { key: ownerA, provider: "fake", modelId: "changed" });
      requested.resolve(undefined);
      await release.promise;
      modelA = "changed";
      return Response.json(null);
    }
    if (key === ownerA) readsA += 1;
    else readsB += 1;
    return Response.json(controls(key === ownerA ? modelA : "second"));
  });
  const a = requests.controls(ownerA);
  const b = requests.controls(ownerB);
  registry.mount(a);
  registry.mount(b);
  await Effect.runPromise(AtomRegistry.getResult(registry, a));
  await Effect.runPromise(AtomRegistry.getResult(registry, b));
  const mutationA = requests.changeControls(ownerA);
  const mutationB = requests.changeControls(ownerB);
  const unmount = registry.mount(mutationA);
  registry.set(mutationA, { type: "model", provider: "fake", modelId: "changed" });
  await requested.promise;
  unmount();
  assert.equal(registry.get(mutationA).waiting, true);
  assert.equal(registry.get(mutationB).waiting, false);
  release.resolve(undefined);
  await Effect.runPromise(AtomRegistry.getResult(registry, mutationA, { suspendOnWaiting: true }));
  assert.equal(
    (await Effect.runPromise(AtomRegistry.getResult(registry, a, { suspendOnWaiting: true }))).model
      ?.id,
    "changed",
  );
  assert.equal(registry.get(mutationA).waiting, false);
  assert.equal(AsyncResult.getOrThrow(registry.get(b)).model?.id, "second");
  assert.equal(readsA, 2);
  assert.equal(readsB, 1);
});

test("a rejected thinking change is not retried and a later success refreshes controls", async (t) => {
  let changes = 0;
  let reads = 0;
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/api/thinking") {
      const payload: unknown = await request.json();
      assert.deepEqual(payload, { key: ownerA, level: "high" });
      changes += 1;
      return changes === 1
        ? Response.json({ error: "Wait until Pi is idle" }, { status: 400 })
        : Response.json(null);
    }
    reads += 1;
    return Response.json({
      ...controls("first"),
      thinkingLevel: changes === 2 ? "high" : "off",
    });
  });
  const query = requests.controls(ownerA);
  const mutation = requests.changeControls(ownerA);
  registry.mount(query);
  await Effect.runPromise(AtomRegistry.getResult(registry, query));
  registry.set(mutation, { type: "thinking", level: "high" });
  await assert.rejects(
    Effect.runPromise(AtomRegistry.getResult(registry, mutation, { suspendOnWaiting: true })),
    /Wait until Pi is idle/u,
  );
  assert.equal(requestFeedback(registry.get(mutation)), "Wait until Pi is idle");
  assert.equal(registry.get(mutation).waiting, false);
  assert.equal(changes, 1);
  assert.equal(reads, 1, "A rejection must not invalidate controls");
  registry.set(mutation, { type: "thinking", level: "high" });
  await Effect.runPromise(AtomRegistry.getResult(registry, mutation, { suspendOnWaiting: true }));
  assert.equal(requestFeedback(registry.get(mutation)), null);
  assert.equal(
    (await Effect.runPromise(AtomRegistry.getResult(registry, query, { suspendOnWaiting: true })))
      .thinkingLevel,
    "high",
  );
  assert.equal(changes, 2);
  assert.equal(reads, 2);
});

test("history queries remain associated with their owner across overlapping requests", async (t) => {
  const requested = Promise.withResolvers<undefined>();
  const first = Promise.withResolvers<Response>();
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    const { key } = S.decodeUnknownSync(TargetSchema)(await request.json());
    if (key === ownerA) {
      requested.resolve(undefined);
      return first.promise;
    }
    return Response.json({ leafId: "b", entries: [{ id: "b", parentId: null, label: "B" }] });
  });
  const a = requests.history(ownerA);
  const b = requests.history(ownerB);
  registry.mount(a);
  await requested.promise;
  registry.mount(b);
  assert.equal((await Effect.runPromise(AtomRegistry.getResult(registry, b))).leafId, "b");
  first.resolve(Response.json({ leafId: "a", entries: [{ id: "a", parentId: null, label: "A" }] }));
  assert.equal((await Effect.runPromise(AtomRegistry.getResult(registry, a))).leafId, "a");
  assert.equal(AsyncResult.getOrThrow(registry.get(b)).leafId, "b");
});

test("account selection reports rejection without retrying and can subsequently succeed", async (t) => {
  let selections = 0;
  const { registry, requests } = setup(t, async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/api/accounts") {
      return Response.json([{ profile: "one" }, { profile: "two" }]);
    }
    assert.deepEqual(await request.json(), { profile: "two" });
    selections += 1;
    return selections === 1
      ? Response.json({ error: "Account unavailable" }, { status: 400 })
      : Response.json(null);
  });
  registry.mount(requests.accounts);
  assert.equal(
    (await Effect.runPromise(AtomRegistry.getResult(registry, requests.accounts))).length,
    2,
  );
  registry.set(requests.selectAccount, { payload: { profile: "two" } });
  await assert.rejects(
    Effect.runPromise(
      AtomRegistry.getResult(registry, requests.selectAccount, { suspendOnWaiting: true }),
    ),
    /Account unavailable/u,
  );
  assert.equal(requestFeedback(registry.get(requests.selectAccount)), "Account unavailable");
  assert.equal(selections, 1);
  registry.set(requests.selectAccount, { payload: { profile: "two" } });
  await Effect.runPromise(
    AtomRegistry.getResult(registry, requests.selectAccount, { suspendOnWaiting: true }),
  );
  assert.equal(requestFeedback(registry.get(requests.selectAccount)), null);
  assert.equal(selections, 2);
});
