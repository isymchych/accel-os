import path from "node:path";
import { mock } from "node:test";

import type { DesktopOptions } from "../../../src/electron/main.ts";

mock.module("electron", { exports: { app: { quit: () => {} } } });
mock.module(path.resolve(import.meta.dirname, "../../../src/electron/main.ts"), {
  exports: {
    startDesktop: async ({ pi, developmentUrl, userData }: DesktopOptions) => {
      console.log(`executable:${pi.executable}`);
      console.log(`args:${JSON.stringify(pi.args)}`);
      console.log(`cwd:${pi.cwd}`);
      console.log(`renderer:${developmentUrl ?? "built"}`);
      console.log(`user-data:${userData ?? "default"}`);
    },
  },
});

await import("../../../src/electron/entry.ts");
