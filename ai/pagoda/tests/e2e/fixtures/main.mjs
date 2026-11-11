import path from "node:path";

import { app } from "electron";

import { startDesktop } from "../../../dist/main/electron/main.js";

// An explicit Electron executable leaves Playwright's debug flags in process.argv.
const [url, directory] = process.argv.slice(-2);
if (!url || !directory)
  throw new Error("Expected the backend connection URL and temporary directory");

/** @param {unknown} error */
function failed(error) {
  console.error(error);
  app.quit();
}

app.on("web-contents-created", (_event, contents) => {
  contents.session.setSpellCheckerEnabled(false);
});

void startDesktop({
  url,
  userData: path.join(directory, "electron"),
}).catch(failed);
