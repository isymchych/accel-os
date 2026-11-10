import path from "node:path";

import { app } from "electron";

import { startDesktop } from "../../../dist/main/electron/main.js";

// An explicit Electron executable leaves Playwright's debug flags in process.argv.
const [node, directory] = process.argv.slice(-2);
if (!node || !directory)
  throw new Error("Expected the test Node executable and temporary directory");

/** @param {unknown} error */
function failed(error) {
  console.error(error);
  app.quit();
}

app.on("web-contents-created", (_event, contents) => {
  contents.session.setSpellCheckerEnabled(false);
});

void startDesktop({
  pi: {
    executable: node,
    args: [path.resolve(import.meta.dirname, "../../integration/fixtures/fake-pi.ts")],
    cwd: directory,
    env: { ...process.env },
  },
  userData: path.join(directory, "electron"),
}).catch(failed);
