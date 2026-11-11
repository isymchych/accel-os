import { parseArgs } from "node:util";

import { backendOptions, runApplication } from "./application.ts";

const { values } = parseArgs({
  options: { ...backendOptions, dev: { type: "boolean", default: false } },
});
await runApplication(values, false);
