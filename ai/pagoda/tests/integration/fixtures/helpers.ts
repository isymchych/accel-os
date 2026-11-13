import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, FileSystem, Scope } from "effect";

import { SessionMetadataStore } from "../../../src/backend/session-metadata.ts";
import type { DesktopSession } from "../../../src/backend/session.ts";
import type { ContentBlock, SessionSnapshot } from "../../../src/contracts/index.ts";
import { fakePiOptions } from "./fake-sdk.ts";

export { fakePiOptions, fakeSessionFactory } from "./fake-sdk.ts";

/** Create an isolated synthetic account for normal backend startup. */
export async function setupFakePi(directory: string): Promise<void> {
  const profile = path.join(fakePiOptions(directory).agentDir, "profiles", ".pi-account-test");
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, "auth.json"), "{}");
}

export async function metadataStore(agentDir: string): Promise<SessionMetadataStore> {
  const fs = await Effect.runPromise(
    FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)),
  );
  return new SessionMetadataStore(fs, path.join(agentDir, "pagoda-state.json"));
}

/** Keep native Effect resources alive until the owning test finishes. */
export function runScoped<A, E>(
  t: TestContext,
  effect: Effect.Effect<A, E, Scope.Scope>,
): Promise<A> {
  const scope = Scope.makeUnsafe();
  t.after(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  return Effect.runPromise(effect.pipe(Scope.provide(scope)));
}
export function contentText(content: readonly ContentBlock[] | undefined): string {
  return (content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

export async function waitForSession(
  session: DesktopSession,
  predicate: (snapshot: SessionSnapshot) => boolean,
  options: { timeout: number; description: string },
): Promise<SessionSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(options.description));
    }, options.timeout);
    const receive = (snapshot: SessionSnapshot): void => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(snapshot);
    };
    const unsubscribe = session.subscribe(receive);
    receive(session.snapshot());
  });
}
