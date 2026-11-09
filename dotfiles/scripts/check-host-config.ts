import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getErrorMessage } from "@accel-os/shared/guards";

import { readRepositoryHostConfig, validateHostConfig } from "./lib/host-config.ts";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, "../..");

try {
  const config = await readRepositoryHostConfig(repositoryRoot);
  const errors = validateHostConfig(config);

  if (errors.length > 0) {
    console.error(
      `Host configuration validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Host configuration validation failed: ${getErrorMessage(error)}`);
  process.exitCode = 1;
}
