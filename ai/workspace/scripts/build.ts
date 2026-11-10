import { rm } from "node:fs/promises";

import { run, source } from "./process.ts";

await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
await run("pnpm", ["exec", "tsc", "--project", "electron/tsconfig.build.json"], source);
await run("pnpm", ["exec", "vite", "build"], source);
