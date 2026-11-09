import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const binDirectory = resolve(scriptsDirectory, "../bin");
const completionDeclaration = /^# zsh-completion:\s+(completions\/_[a-z0-9-]+)\s*$/m;
const compdefDeclaration = /^#compdef\s+(.+)$/m;

const entries = await readdir(binDirectory, { withFileTypes: true });
const commandScripts = entries
  .filter((entry) => entry.isFile() && entry.name.startsWith("executable_mb-"))
  .map((entry) => entry.name)
  .sort();
const errors: string[] = [];

for (const scriptName of commandScripts) {
  const command = scriptName.slice("executable_".length);
  const scriptPath = resolve(binDirectory, scriptName);
  const script = await readFile(scriptPath, "utf8");
  const completionPath = script.match(completionDeclaration)?.[1];

  if (completionPath === undefined) {
    errors.push(`${scriptName}: missing "# zsh-completion: completions/_mb-..." declaration`);
    continue;
  }

  let completion: string;
  try {
    completion = await readFile(resolve(binDirectory, completionPath), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      errors.push(`${scriptName}: declared completion does not exist: ${completionPath}`);
    } else {
      errors.push(`${scriptName}: could not read completion ${completionPath}: ${String(error)}`);
    }
    continue;
  }

  const compdef = completion.match(compdefDeclaration)?.[1];
  if (compdef === undefined) {
    errors.push(`${completionPath}: missing "#compdef" declaration`);
    continue;
  }

  if (!compdef.split(/\s+/).includes(command)) {
    errors.push(`${completionPath}: #compdef does not declare ${command}`);
  }
}

if (errors.length > 0) {
  console.error(
    `Zsh completion validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
  process.exitCode = 1;
}
