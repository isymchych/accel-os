import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

// Copied into an isolated checkout as its npm check/build commands.
const source = process.cwd();
const state = process.env["WORKSPACE_STATE_DIR"];
if (state === undefined) throw new Error("The fixture requires isolated saved state.");
const recipe = process.argv[2];
const scenarioPath = join(state, "scenario");
const scenario = existsSync(scenarioPath) ? await readFile(scenarioPath, "utf8") : "";

await appendFile(join(state, "commands"), `${recipe}\n`);
if (recipe === "check") {
  await writeFile(join(state, "check.pid"), String(process.pid));
  if (scenario === "check") throw new Error("Synthetic check failure.");
  while (existsSync(join(state, "check.hold"))) await delay(20);
} else if (recipe === "build") {
  if (scenario === "build") throw new Error("Synthetic build failure.");
  const directory = process.argv.at(4);
  if (process.argv[3] !== "--candidate" || directory === undefined || !process.argv.at(5))
    throw new Error("Expected candidate directory and version.");
  await promisify(execFile)("tsc", [
    "--project",
    resolve(source, "server/tsconfig.api-build.json"),
    "--outDir",
    directory,
  ]);
  await mkdir(join(directory, "dist"));
  await writeFile(join(directory, "dist/index.html"), "<main>new</main>");
  if (scenario === "child-import") {
    await writeFile(join(directory, "server/app/api.js"), "not valid JavaScript");
  } else if (scenario === "listen") {
    await writeFile(
      join(directory, "server/app/main.js"),
      `
      process.send({kind: "prepared"});
      process.on("message", () => process.exit(1));
      `,
    );
  } else if (scenario === "publish") {
    await mkdir(join(state, "current.next"));
  }
} else {
  throw new Error("Unsupported fixture command.");
}
