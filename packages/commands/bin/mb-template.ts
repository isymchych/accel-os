import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";

import { getErrorMessage } from "@accel-os/shared/guards";

const TEMPLATES_DIRECTORY = new URL("../assets/mb-template/templates/", import.meta.url);
const USAGE = "Usage: mb-template list | mb-template copy <name>";

function main(): number {
  const args = process.argv.slice(2);
  if (!(args.length === 1 && args[0] === "list") && !(args.length === 2 && args[0] === "copy")) {
    throw new Error(USAGE);
  }

  // Noctalia interpolates selections into a shell command without escaping.
  // Only expose plain filenames, and validate copying against the same allowlist.
  const names = readdirSync(TEMPLATES_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (args[0] === "list") {
    for (const name of names) {
      process.stdout.write(`${name}\n`);
    }
    return 0;
  }

  const name = args[1];
  if (name === undefined || !names.includes(name)) {
    throw new Error(`Unknown template: ${name}`);
  }

  const result = spawnSync("wl-copy", ["--type", "text/plain"], {
    input: readFileSync(new URL(name, TEMPLATES_DIRECTORY)),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
}
