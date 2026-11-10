/**
 * Desktop RPC entry point. Reuses the terminal launch configuration without
 * loading account selection UI or maintaining a second extension/tool list.
 */
import path from "node:path";
import { parseArgs } from "node:util";

import { resolveAccountProfile } from "./accounts.ts";
import { launchPi } from "./pi-launcher.ts";

const accelOs = process.env["ACCEL_OS"];
if (!accelOs) throw new Error("ACCEL_OS is not set");
const { values } = parseArgs({
  options: {
    "profile-dir": { type: "string" },
    "code-navigation": { type: "string", default: "srcwalk" },
  },
});
const codeNavigation = values["code-navigation"];
if (codeNavigation !== "srcwalk" && codeNavigation !== "tilth") {
  throw new Error("invalid desktop code navigation backend");
}
const directory =
  values["profile-dir"] ?? (await resolveAccountProfile(path.join(accelOs, "ai/pi"))).directory;

await launchPi(accelOs, { directory }, ["--mode", "rpc"], codeNavigation);
