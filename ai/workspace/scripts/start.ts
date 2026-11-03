import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve(import.meta.dirname, "..");
const state = resolve(process.env["WORKSPACE_STATE_DIR"] ?? resolve(source, ".workspace"));
process.chdir(source);
process.env["WORKSPACE_STATE_DIR"] = state;

try {
  await import(pathToFileURL(resolve(state, "owner/launcher/main.js")).href);
} catch (error) {
  console.error("Could not load the built workspace. Run npm run build first.", error);
  process.exitCode = 1;
}
