import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, "../../..");
const testDirectory = path.join(repositoryRoot, "dotfiles/dot_config/emacs/tests");

function emacs(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync("emacs", ["--batch", "-Q", ...args], { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Emacs failed (${result.signal ?? result.status})`);
  }
}

emacs(["--directory", scriptsDirectory, "--load", path.join(scriptsDirectory, "check-emacs.el")], {
  ...process.env,
  ACCEL_OS: repositoryRoot,
});

const testFiles = readdirSync(testDirectory)
  .filter((name) => name.endsWith("-test.el"))
  .sort()
  .map((name) => path.join(testDirectory, name));
if (testFiles.length === 0) throw new Error(`No Emacs tests found in ${testDirectory}`);

const startupTests = testFiles.filter((file) => file.endsWith("-startup-test.el"));
const unitTests = testFiles.filter((file) => !file.endsWith("-startup-test.el"));
const loadArgs = (files: string[]): string[] => files.flatMap((file) => ["--load", file]);
const runTests = ["--funcall", "ert-run-tests-batch-and-exit"];

if (unitTests.length > 0) emacs([...loadArgs(unitTests), ...runTests]);
if (startupTests.length > 0) {
  const startupDirectory = mkdtempSync(path.join(tmpdir(), "emacs-startup-"));
  try {
    emacs(
      [
        "--directory",
        scriptsDirectory,
        "--load",
        path.join(scriptsDirectory, "check-emacs-startup.el"),
        ...loadArgs(startupTests),
        ...runTests,
      ],
      { ...process.env, ACCEL_OS: repositoryRoot, EMACS_TEST_DIRECTORY: startupDirectory },
    );
  } finally {
    rmSync(startupDirectory, { recursive: true, force: true });
  }
}
