import path from "node:path";
import { parseArgs } from "node:util";

import { app } from "electron";

import { startDesktop } from "./main.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    node: { type: "string" },
    cwd: { type: "string" },
    "profile-dir": { type: "string" },
    "code-navigation": { type: "string" },
    "dev-url": { type: "string" },
  },
});
const accelOs = process.env["ACCEL_OS"];
if (!values.node || !values.cwd || !accelOs) {
  throw new Error("Start the app through `ai ui` or the workspace pnpm scripts.");
}
const args = [path.join(accelOs, "ai/pi/runtime/rpc-entry.ts")];
for (const name of ["profile-dir", "code-navigation"] as const) {
  const value = values[name];
  if (value !== undefined) args.push(`--${name}`, value);
}

// Awaiting app.whenReady at module level blocks Electron's ESM entry-point startup.
void startDesktop({
  pi: { executable: values.node, args, cwd: values.cwd, env: { ...process.env } },
  ...(values["dev-url"] === undefined ? {} : { developmentUrl: values["dev-url"] }),
}).catch((error: unknown) => {
  console.error("Desktop startup failed:", error);
  app.quit();
});
