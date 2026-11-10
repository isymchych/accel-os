import { createServer } from "vite";

import { launchElectron, run, source } from "./process.ts";

await run("pnpm", ["exec", "tsc", "--project", "electron/tsconfig.build.json"], source);
const server = await createServer({ root: source, configFile: `${source}/vite.config.ts` });
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a loopback development URL");
  console.log(
    "Renderer updates are live. Restart this command after main/preload/Pi integration edits.",
  );
  await launchElectron(url);
} finally {
  await server.close();
}
