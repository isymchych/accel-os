import path from "node:path";
import { mock } from "node:test";

import type { DesktopOptions } from "../../../src/electron/main.ts";

mock.module("electron", { exports: { app: { quit: () => {} } } });
mock.module(path.resolve(import.meta.dirname, "../../../src/electron/main.ts"), {
  exports: {
    startDesktop: async ({ url }: DesktopOptions): Promise<void> => {
      console.log(`renderer:${url}`);
    },
  },
});
await import("../../../src/electron/entry.ts");
