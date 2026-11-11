import { parseArgs } from "node:util";

import { app } from "electron";

import { startDesktop } from "./main.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { url: { type: "string" } },
});
const url = values.url ?? process.env["PAGODA_URL"];
if (!url) throw new Error("Set PAGODA_URL to the connection URL printed by the backend.");

// Awaiting app.whenReady at module level blocks Electron's ESM startup.
void startDesktop({ url }).catch(() => {
  console.error("Could not open Pagoda. Check PAGODA_URL and that the backend is running.");
  app.exit(1);
});
