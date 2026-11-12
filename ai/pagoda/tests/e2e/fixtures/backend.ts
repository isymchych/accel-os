import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test as base } from "@playwright/test";

import { startBackend, type Backend } from "../../../src/backend/server.ts";
import { fakePiOptions, fakeSessionFactory } from "../../integration/fixtures/helpers.ts";

export interface TestBackend {
  backend: Backend;
  directory: string;
}

export const test = base.extend<{ testBackend: TestBackend }>({
  // Playwright requires fixture dependencies to use a destructured parameter.
  // oxlint-disable-next-line no-empty-pattern
  testBackend: async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), "pagoda-e2e-"));
    let backend: Backend | undefined;
    try {
      backend = await startBackend({
        port: 0,
        stateFile: path.join(directory, "pagoda-state.json"),
        clientDirectory: path.resolve(import.meta.dirname, "../../../dist/client"),
        pi: fakePiOptions(directory),
        sessionFactory: fakeSessionFactory,
      });
      await use({ backend, directory });
    } finally {
      try {
        await backend?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
});
