import { parseArgs } from "node:util";

import { backendOptions, runApplication } from "./application.ts";

const { values } = parseArgs({
  options: { ...backendOptions, browser: { type: "boolean", default: false } },
});
await runApplication(values, true);
