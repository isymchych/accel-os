import { access } from "node:fs/promises";
import path from "node:path";

import { launchElectron, source } from "./process.ts";

try {
  await access(path.join(source, "dist/main/electron/main.js"));
} catch {
  throw new Error('Build the desktop app first: pnpm --dir "$ACCEL_OS/ai/workspace" run build');
}
await launchElectron();
